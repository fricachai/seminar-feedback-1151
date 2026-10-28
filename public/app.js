const $ = id => document.getElementById(id);
const API = (globalThis.SEMINAR_CONFIG?.apiBase || '').replace(/\/$/, '');
const TOKEN_KEY = 'seminar-1151-session';
const TEACHER_TOKEN_KEY = 'seminar-1151-teacher';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_FEEDBACK_CHARS = 3000;
const VIEWS = ['home', 'upload', 'feedback', 'received', 'teacher'];
const PAPER_NAME = /^\d{4}_.+\.pdf$/i;
const state = { token: '', students: [], presenter: '', reviewer: '', originalContent: '', originalTakeaway: '', revision: 0, ready: false, saving: false, loading: false, uploading: false, uploadSyncing: false, paperUploadId: '', presentationUploadId: '', loadSeq: 0, uploadLookupSeq: 0, progressSeq: 0, progressController: null, receivedSeq: 0, receivedController: null, teacherToken: '', teacherLoading: false, teacherSeq: 0, controller: null, authenticatedBefore: false, view: 'home' };
try { state.token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { /* Private browsing may restrict storage; the in-memory session still works. */ }
try { state.teacherToken = sessionStorage.getItem(TEACHER_TOKEN_KEY) || ''; } catch { /* In-memory teacher session remains available. */ }
const dirty = () => $('suggestion').value !== state.originalContent || $('takeaway').value !== state.originalTakeaway;
const pairIsValid = () => state.presenter && state.reviewer && state.presenter !== state.reviewer;
let discardResolver = null;

function confirmDiscard(text) {
  const dialog = $('confirm-dialog');
  if (dialog.open) return Promise.resolve(false);
  $('confirm-message').textContent = text;
  return new Promise(resolve => {
    discardResolver = resolve;
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}

function resolveDiscard(approved) {
  const resolve = discardResolver;
  discardResolver = null;
  $('confirm-dialog').close();
  resolve?.(approved);
}
$('confirm-cancel').addEventListener('click', () => resolveDiscard(false));
$('confirm-continue').addEventListener('click', () => resolveDiscard(true));
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); resolveDiscard(false); });

function storeToken(token) {
  state.token = token;
  try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* In-memory fallback. */ }
}

function message(id, text, kind = '') {
  const node = $(id);
  node.textContent = text;
  node.classList.remove('error', 'success');
  if (kind) node.classList.add(kind);
}

function currentViewFromHash() {
  const value = location.hash.slice(1);
  return VIEWS.includes(value) ? value : 'home';
}

function showViewNow(view) {
  state.view = view;
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  history.replaceState(null, '', `#${view}`);
  if (view === 'feedback') {
    renderArticles();
    if (pairIsValid() && !state.ready) loadPair();
  }
  if (view === 'upload') { renderUploadExisting(); renderProgressView(); }
  if (view === 'received') renderReceivedView();
  if (view === 'teacher') initTeacherView();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function applyView(view) {
  if (view === state.view) return;
  if (state.uploading) {
    history.replaceState(null, '', `#${state.view}`);
    message('material-status', '正在上傳，請稍候再切換頁面。', 'error');
    return;
  }
  if (state.view === 'upload' && ($('paper-file').files.length || $('presentation-file').files.length)) {
    const leave = await confirmDiscard('目前選擇的檔案尚未送出。仍要離開這個頁面嗎？返回後可繼續選擇並送出。');
    if (!leave) { history.replaceState(null, '', '#upload'); return; }
  }
  if (state.view === 'feedback' && dirty()) {
    const leave = await confirmDiscard('目前的建議或心得尚未儲存。離開後內容會清空，仍要離開這個頁面嗎？');
    if (!leave) { history.replaceState(null, '', '#feedback'); return; }
  }
  if (state.view === 'feedback') clearFeedbackDraft();
  showViewNow(view);
}

addEventListener('hashchange', () => {
  const view = currentViewFromHash();
  if (view !== state.view) applyView(view);
});

async function api(path, options = {}) {
  if (!API) throw new Error('課程網站尚未連接資料服務，請聯絡老師。');
  const controller = new AbortController();
  const {timeoutMs = 20000, ...requestOptions} = options;
  const timer = setTimeout(() => controller.abort(new Error('連線逾時，請保留文字後再試。')), timeoutMs);
  const externalSignal = options.signal;
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) controller.abort();
  try {
    const headers = new Headers(options.headers);
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${API}${path}`, { ...requestOptions, headers, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data.error || '暫時無法連線，請稍後再試。'), { status: response.status, code: data.code });
    }
    return options.binary ? response : await response.json();
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function authError(error) {
  if (error.status !== 401 || !state.authenticatedBefore || error.code === 'TEACHER_AUTH' || error.code === 'TEACHER_LOGIN') return false;
  $('gate').hidden = false;
  $('classroom').hidden = true;
  $('logout').hidden = true;
  message('login-status', '課程連線已到期，請重新輸入通關碼。尚未儲存的文字請先複製保留。', 'error');
  $('class-code').focus();
  return true;
}

function setBadge(text, kind = '') {
  $('save-badge').textContent = text;
  $('save-badge').className = `save-badge ${kind}`;
}

function updateControls() {
  const suggestion = $('suggestion').value;
  const takeaway = $('takeaway').value;
  $('word-count').textContent = `${suggestion.length.toLocaleString('zh-TW')} / 3,000`;
  $('takeaway-count').textContent = `${takeaway.length.toLocaleString('zh-TW')} / 3,000`;
  $('save').disabled = !state.ready || state.saving || state.loading || !pairIsValid() || !dirty() || (!suggestion.trim() && !takeaway.trim());
  $('suggestion').disabled = !state.ready || state.saving || !pairIsValid();
  $('takeaway').disabled = !state.ready || state.saving || !pairIsValid();
  $('presenter').disabled = state.saving || state.loading;
  $('reviewer').disabled = state.saving || state.loading;
  $('refresh-catalog').disabled = state.saving || state.loading || state.uploading || state.uploadSyncing;
  $('logout').disabled = state.saving || state.loading || state.uploading || state.teacherLoading;
  const uploadBusy = state.uploading || state.loading || state.uploadSyncing || state.saving;
  $('uploader').disabled = uploadBusy;
  $('paper-file').disabled = uploadBusy;
  $('presentation-file').disabled = uploadBusy;
  $('material-submit').disabled = uploadBusy || !$('uploader').value || (!$('paper-file').files.length && !$('presentation-file').files.length);
  $('progress-student').disabled = state.loading;
  $('progress-reload').disabled = state.loading;
  $('received-student').disabled = state.loading;
  $('received-reload').disabled = state.loading;
  $('teacher-presenter').disabled = state.teacherLoading || state.loading;
  $('teacher-logout').disabled = state.teacherLoading;
  $('teacher-login-button').disabled = state.teacherLoading;
  if (state.saving) setBadge('儲存中…');
  else if (state.ready && dirty()) setBadge('尚未儲存', 'dirty');
  else if (state.ready && state.revision > 0) setBadge('已儲存', 'saved');
  else if (state.ready) setBadge('等待你的建議');
}

function globalStatus(text = '') {
  $('global-status').textContent = text;
  $('global-status').hidden = !text;
}

function formatTime(value, withYear = false) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', ...(withYear ? { year: 'numeric' } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function paperFileError(file) {
  if (!file) return '請選擇文章 PDF。';
  if (!file.size) return '文章檔案不可為空，請重新選擇 PDF。';
  if (file.size > MAX_UPLOAD_BYTES) return '檔案大小超過 5MB！請選擇 5MB 以內的 PDF。';
  if (!/\.pdf$/i.test(file.name) || !PAPER_NAME.test(file.name) || file.name.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(file.name)) {
    return '文章檔名需為「年份_篇名.pdf」，例：2024_綠色行銷對品牌權益的影響.pdf。請重新命名後再選擇。';
  }
  return '';
}

function presentationFileError(file) {
  if (!file) return '請選擇簡報檔。';
  if (!file.size) return '簡報檔案不可為空，請重新選擇檔案。';
  if (file.size > MAX_UPLOAD_BYTES) return '檔案大小超過 5MB！請選擇 5MB 以內的 PPT、PPTX 或 PDF。';
  if (!/\.(pptx?|pdf)$/i.test(file.name)) return '簡報檔案需為 PPT、PPTX 或 PDF。';
  return '';
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('檔案讀取失敗，請重新選取。'));
    reader.readAsDataURL(file);
  });
}

function clearMaterialFiles() {
  $('paper-file').value = '';
  $('presentation-file').value = '';
  $('paper-filename').textContent = '尚未選擇檔案';
  $('presentation-filename').textContent = '尚未選擇檔案';
  state.paperUploadId = '';
  state.presentationUploadId = '';
  message('paper-status', '');
  message('presentation-status', '');
}

function renderUploadNote(id, text) {
  const area = $(id);
  area.replaceChildren();
  const note = document.createElement('p');
  note.className = 'field-note';
  note.textContent = text;
  area.append(note);
}

function renderUploadList(id, student, items, labelFor, emptyText) {
  if (!student) { renderUploadNote(id, '請先選擇自己的學號與姓名。'); return; }
  if (!items?.length) { renderUploadNote(id, emptyText); return; }
  const list = document.createElement('ul');
  for (const [index, item] of items.entries()) {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'upload-item-name';
    name.textContent = labelFor(item);
    if (item.title && item.title !== name.textContent) name.title = item.title;
    const meta = document.createElement('span');
    meta.className = 'upload-item-meta';
    meta.textContent = `${index === 0 ? '最新・' : ''}${(Number(item.byteSize) / 1024 / 1024).toFixed(2)} MB`;
    row.append(name, meta);
    list.append(row);
  }
  const area = $(id);
  area.replaceChildren(list);
}

function renderUploadExisting() {
  const studentId = $('uploader').value;
  const student = state.students.find(s => s.id === studentId);
  if (studentId && !student && (state.loading || state.uploadSyncing)) {
    renderUploadNote('paper-existing', '正在讀取雲端文章…');
    renderUploadNote('presentation-existing', '正在讀取雲端簡報…');
    return;
  }
  renderUploadList('paper-existing', student, student?.papers, p => p.filename || p.title, '尚未上傳文章。');
  renderUploadList('presentation-existing', student, student?.presentations, p => p.filename, '尚未上傳簡報。');
}

async function syncStudentMaterials() {
  const studentId = $('uploader').value;
  const seq = ++state.uploadLookupSeq;
  if (!studentId) {
    state.uploadSyncing = false;
    message('upload-lookup-status', '請先選擇自己的學號與姓名。');
    renderUploadExisting();
    updateControls();
    return;
  }
  state.uploadSyncing = true;
  updateControls();
  message('upload-lookup-status', '正在更新雲端文章與簡報…');
  try {
    await api('/api/sync', { method: 'POST', timeoutMs: 60000 });
    if (seq !== state.uploadLookupSeq) return;
    await loadCatalog({ preserve: true, pair: false });
    if (seq !== state.uploadLookupSeq) return;
    const student = state.students.find(s => s.id === studentId);
    if (!student) {
      message('upload-lookup-status', '雲端名單已更新，請重新選擇自己的學號與姓名。', 'error');
      return;
    }
    message('upload-lookup-status', `已更新雲端資料：文章 ${student.papers.length} 份、簡報 ${student.presentations?.length || 0} 份。`, 'success');
  } catch (error) {
    if (seq !== state.uploadLookupSeq) return;
    if (authError(error)) return;
    message('upload-lookup-status', `雲端資料暫時無法更新：${error.message} 以下顯示上次同步的內容。`, 'error');
    renderUploadExisting();
  } finally {
    if (seq === state.uploadLookupSeq) {
      state.uploadSyncing = false;
      updateControls();
    }
  }
}

function renderArticles() {
  renderPresentations();
  const area = $('article-area');
  area.replaceChildren();
  const student = state.students.find(s => s.id === state.presenter);
  if (!student) {
    const box = document.createElement('div');
    box.className = 'article-placeholder';
    const icon = document.createElement('span'); icon.className = 'outline-book'; icon.textContent = '▤'; icon.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('h3'); heading.textContent = '等待一場知識的分享';
    const description = document.createElement('p'); description.textContent = '請先選擇報告同學，文章篇名與 PDF 會顯示在這裡。';
    box.append(icon, heading, description); area.append(box); return;
  }
  if (!student.papers.length) {
    const card = document.createElement('div'); card.className = 'article-card missing-upload';
    const type = document.createElement('p'); type.className = 'paper-type'; type.textContent = 'ARTICLE NOT YET AVAILABLE';
    const heading = document.createElement('h3'); heading.textContent = '尚未上傳';
    const note = document.createElement('p'); note.className = 'field-note'; note.textContent = '目前尚無這位同學的文章 PDF，請稍後再查看。';
    card.append(type, heading, note); area.append(card); return;
  }
  for (const paper of student.papers) {
    const card = document.createElement('article'); card.className = 'article-card';
    const type = document.createElement('p'); type.className = 'paper-type';
    const tag = document.createElement('span'); tag.textContent = 'PDF'; type.append(tag, ' JOURNAL ARTICLE');
    const heading = document.createElement('h3'); heading.textContent = paper.title;
    const link = document.createElement('a'); link.className = 'pdf-link'; link.href = `${API}/api/papers/${paper.id}`; link.textContent = '下載文章 PDF ↗';
    link.addEventListener('click', async event => {
      event.preventDefault();
      if (link.getAttribute('aria-disabled') === 'true') return;
      link.setAttribute('aria-disabled', 'true'); link.textContent = '正在準備 PDF…';
      try {
        const response = await api(`/api/papers/${paper.id}`, { binary: true, timeoutMs:60000 });
        const blob = await response.blob();
        if (blob.type.split(';')[0] !== 'application/pdf') throw new Error('檔案格式不符，請稍後再試。');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${paper.title}.pdf`; a.hidden = true; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { if (!authError(error)) globalStatus(`下載未完成：${error.message}`); }
      finally { link.removeAttribute('aria-disabled'); link.textContent = '下載文章 PDF ↗'; }
    });
    const size = document.createElement('p'); size.className = 'paper-size'; size.textContent = `${(paper.byteSize / 1024 / 1024).toFixed(2)} MB・供課堂閱讀與討論使用`;
    card.append(type, heading, link, size); area.append(card);
  }
}

function renderPresentations() {
  const area = $('presentation-area'); area.replaceChildren();
  const student = state.students.find(s => s.id === state.presenter);
  if (!student) {
    const hint = document.createElement('p'); hint.className = 'field-note'; hint.textContent = '請先選擇報告同學。'; area.append(hint); return;
  }
  if (!student.presentations?.length) {
    const card = document.createElement('div'); card.className = 'article-card missing-upload';
    const heading = document.createElement('h3'); heading.textContent = '尚未上傳';
    const hint = document.createElement('p'); hint.className = 'field-note'; hint.textContent = '目前尚無這位同學的報告簡報。';
    card.append(heading,hint); area.append(card); return;
  }
  for (const [index,p] of student.presentations.entries()) {
    const card = document.createElement('article'); card.className = 'article-card presentation-card';
    const heading = document.createElement('h3'); heading.textContent = p.filename;
    const link = document.createElement('a'); link.className = 'pdf-link'; link.href = `${API}/api/presentations/${p.id}`;
    const label = `下載簡報 ${p.filename.split('.').pop().toUpperCase()} ↗`; link.textContent = label;
    link.addEventListener('click',async event => {
      event.preventDefault(); if (link.getAttribute('aria-disabled') === 'true') return;
      link.setAttribute('aria-disabled','true'); link.textContent = '正在準備簡報…';
      try {
        const response = await api(`/api/presentations/${p.id}`,{binary:true,timeoutMs:60000});
        const blob = await response.blob();
        if (blob.type.split(';')[0] !== p.mimeType) throw new Error('檔案格式不符，請重新更新雲端資料。');
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = p.filename; a.hidden = true; document.body.append(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      } catch (error) {if (!authError(error)) globalStatus(`下載未完成：${error.message}`);}
      finally {link.removeAttribute('aria-disabled'); link.textContent = label;}
    });
    const meta = document.createElement('p'); meta.className = 'paper-size';
    meta.textContent = `${index === 0 ? '最新上傳・' : ''}${(p.byteSize/1024/1024).toFixed(2)} MB・${formatTime(p.modifiedAt,true)}`;
    card.append(heading,link,meta); area.append(card);
  }
}

function clearFeedbackDraft() {
  state.ready = false;
  state.originalContent = '';
  state.originalTakeaway = '';
  state.revision = 0;
  $('suggestion').value = '';
  $('takeaway').value = '';
  updateControls();
}

function loadPair() {
  clearFeedbackDraft();
  if (!state.presenter || !state.reviewer) {
    setBadge('尚未開始'); message('feedback-status', '請先選擇報告同學與你自己的身分。'); return;
  }
  if (!pairIsValid()) {
    setBadge('請確認身分'); message('feedback-status', '你是這次的報告者，請選擇其他同學的報告再留下建議。'); return;
  }
  state.ready = true;
  setBadge('等待你的建議');
  message('feedback-status', '請輸入建議或心得。為保護隱私，不顯示先前內容；儲存後會覆蓋上一次的內容。');
  updateControls();
}

async function loadReceived({ announce = true } = {}) {
  const studentId = $('received-student').value;
  const seq = ++state.receivedSeq;
  state.receivedController?.abort();
  state.receivedController = new AbortController();
  $('received-text').value = '';
  $('received-count').textContent = '';
  if (!studentId) {
    message('received-status', '請選擇自己的學號與姓名。');
    return;
  }
  if (announce) message('received-status', '正在讀取同學給你的建議…');
  try {
    const data = await api(`/api/presenter-feedback?presenter=${encodeURIComponent(studentId)}`, { signal: state.receivedController.signal });
    if (seq !== state.receivedSeq) return;
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions.map(item => String(item)) : [];
    $('received-text').value = suggestions.join('\n\n');
    $('received-count').textContent = suggestions.length ? `共 ${suggestions.length} 位同學提供建議` : '';
    message('received-status', suggestions.length ? '已讀取同學給你的建議。' : '目前尚無同學提供建議。', suggestions.length ? 'success' : '');
  } catch (error) {
    if (seq !== state.receivedSeq || error.name === 'AbortError') return;
    message('received-status', error.message, 'error');
    authError(error);
  }
}

function renderReceivedView() {
  if (!state.students.length) {
    message('received-status', '正在讀取課程名單…');
    return;
  }
  if ($('received-student').value) loadReceived();
  else {
    $('received-text').value = '';
    $('received-count').textContent = '';
    message('received-status', '請選擇自己的學號與姓名。');
  }
}

function renderProgressItems(items) {
  const area = $('progress-list');
  area.replaceChildren();
  if (!items?.length) {
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = '尚未完成任何報告同學的建議或心得。';
    area.append(note);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'progress-items';
  for (const item of items) {
    if (!item.hasSuggestion && !item.hasTakeaway) continue;
    const row = document.createElement('li');
    row.className = 'progress-item';
    const name = document.createElement('span');
    name.className = 'progress-name';
    name.textContent = `${item.presenterId} ${item.presenterName}`;
    const badges = document.createElement('span');
    badges.className = 'progress-badges';
    if (item.hasSuggestion) {
      const badge = document.createElement('span');
      badge.className = 'progress-badge done';
      badge.textContent = '建議已完成';
      badges.append(badge);
    }
    if (item.hasTakeaway) {
      const badge = document.createElement('span');
      badge.className = 'progress-badge done';
      badge.textContent = '心得已完成';
      badges.append(badge);
    }
    row.append(name, badges);
    list.append(row);
  }
  area.append(list);
}

async function loadProgress({ announce = true } = {}) {
  const studentId = $('progress-student').value;
  const seq = ++state.progressSeq;
  state.progressController?.abort();
  state.progressController = new AbortController();
  if (!studentId) {
    $('progress-list').replaceChildren();
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = '尚未選擇身分。';
    $('progress-list').append(note);
    message('progress-status', '請選擇自己的學號與姓名。');
    return;
  }
  if (announce) message('progress-status', '正在讀取你的填寫進度…');
  try {
    const data = await api(`/api/student-progress?reviewer=${encodeURIComponent(studentId)}`, { signal: state.progressController.signal });
    if (seq !== state.progressSeq) return;
    const items = Array.isArray(data.items) ? data.items : [];
    renderProgressItems(items);
    message('progress-status', items.length ? `共完成 ${items.length} 位報告同學。` : '尚未完成任何報告同學的建議或心得。', items.length ? 'success' : '');
  } catch (error) {
    if (seq !== state.progressSeq || error.name === 'AbortError') return;
    message('progress-status', error.message, 'error');
    authError(error);
  }
}

function renderProgressView() {
  if (!state.students.length) {
    message('progress-status', '正在讀取課程名單…');
    return;
  }
  if ($('progress-student').value) loadProgress();
  else {
    $('progress-list').replaceChildren();
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = '尚未選擇身分。';
    $('progress-list').append(note);
    message('progress-status', '選擇身分後，列出你已完成建議或心得的報告同學。');
  }
}

function storeTeacherToken(token) {
  state.teacherToken = token;
  try { token ? sessionStorage.setItem(TEACHER_TOKEN_KEY, token) : sessionStorage.removeItem(TEACHER_TOKEN_KEY); } catch { /* In-memory fallback. */ }
}

function teacherApi(path, options = {}) {
  const headers = new Headers(options.headers);
  if (state.teacherToken) headers.set('X-Teacher-Token', `Bearer ${state.teacherToken}`);
  return api(path, { ...options, headers });
}

function showTeacherLogin(text = '請輸入教師帳號與密碼。', kind = '') {
  $('teacher-login').hidden = false;
  $('teacher-panel').hidden = true;
  message('teacher-login-status', text, kind);
}

function showTeacherPanel() {
  $('teacher-login').hidden = true;
  $('teacher-panel').hidden = false;
  if ($('teacher-presenter').value) loadTeacherFeedback();
  else {
    message('teacher-status', '請選擇報告者。');
    $('teacher-feedback').replaceChildren();
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = '選擇報告者後，會列出每位同學的建議與心得。';
    $('teacher-feedback').append(note);
  }
}

function initTeacherView() {
  if (state.teacherToken) showTeacherPanel();
  else showTeacherLogin();
}

function renderTeacherFeedback(items) {
  const area = $('teacher-feedback');
  area.replaceChildren();
  if (!items?.length) {
    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = '目前尚無同學提供建議或心得。';
    area.append(note);
    return;
  }
  for (const item of items) {
    const block = document.createElement('article');
    block.className = 'teacher-feedback-block';
    const heading = document.createElement('h3');
    heading.textContent = `${item.reviewerId} ${item.reviewerName}`;
    const suggestionLabel = document.createElement('p');
    suggestionLabel.className = 'teacher-field-label';
    suggestionLabel.textContent = '我的建議';
    const suggestion = document.createElement('p');
    suggestion.className = 'teacher-field-text';
    suggestion.textContent = String(item.content || '').trim() || '（未填寫）';
    const takeawayLabel = document.createElement('p');
    takeawayLabel.className = 'teacher-field-label';
    takeawayLabel.textContent = '我的心得';
    const takeaway = document.createElement('p');
    takeaway.className = 'teacher-field-text';
    takeaway.textContent = String(item.takeaway || '').trim() || '（未填寫）';
    block.append(heading, suggestionLabel, suggestion, takeawayLabel, takeaway);
    area.append(block);
  }
}

async function loadTeacherFeedback() {
  const presenter = $('teacher-presenter').value;
  const seq = ++state.teacherSeq;
  if (!presenter) {
    message('teacher-status', '請選擇報告者。');
    renderTeacherFeedback([]);
    return;
  }
  state.teacherLoading = true;
  updateControls();
  message('teacher-status', '正在讀取同學的建議與心得…');
  try {
    const data = await teacherApi(`/api/teacher/feedback?presenter=${encodeURIComponent(presenter)}`);
    if (seq !== state.teacherSeq) return;
    renderTeacherFeedback(data.feedback);
    message('teacher-status', data.feedback.length ? `共 ${data.feedback.length} 位同學提供建議與心得。` : '目前尚無同學提供建議或心得。', data.feedback.length ? 'success' : '');
  } catch (error) {
    if (seq !== state.teacherSeq) return;
    if (error.code === 'TEACHER_AUTH') {
      storeTeacherToken('');
      showTeacherLogin('教師連線已到期，請重新登入。', 'error');
      return;
    }
    message('teacher-status', error.message, 'error');
    authError(error);
  } finally {
    if (seq === state.teacherSeq) {
      state.teacherLoading = false;
      updateControls();
    }
  }
}

async function loadCatalog({ preserve = false, pair = true } = {}) {
  state.loading = true;
  const oldPresenter = state.presenter, oldReviewer = state.reviewer, oldUploader = $('uploader').value;
  const oldProgress = $('progress-student').value;
  const oldReceived = $('received-student').value, oldTeacherPresenter = $('teacher-presenter').value;
  updateControls();
  globalStatus();
  try {
    const data = await api('/api/catalog');
    state.students = data.students;
    for (const [id, hint] of [['presenter', '請選擇報告者的學號與姓名'], ['reviewer', '請選擇填寫者的學號與姓名'], ['uploader','請選擇自己的學號與姓名'], ['progress-student','請選擇自己的學號與姓名'], ['received-student','請選擇自己的學號與姓名'], ['teacher-presenter','請選擇報告者的學號與姓名']]) {
      $(id).replaceChildren(new Option(hint, ''));
      for (const student of data.students) $(id).add(new Option(`${student.id} ${student.name}`, student.id));
    }
    state.presenter = data.students.some(s => s.id === oldPresenter) ? oldPresenter : '';
    state.reviewer = data.students.some(s => s.id === oldReviewer) ? oldReviewer : '';
    $('presenter').value = state.presenter; $('reviewer').value = state.reviewer;
    const nextUploader = data.students.some(s=>s.id === oldUploader) ? oldUploader : '';
    if (nextUploader !== oldUploader) clearMaterialFiles();
    $('uploader').value = nextUploader;
    $('progress-student').value = data.students.some(s => s.id === oldProgress) ? oldProgress : '';
    $('received-student').value = data.students.some(s => s.id === oldReceived) ? oldReceived : '';
    $('teacher-presenter').value = data.students.some(s => s.id === oldTeacherPresenter) ? oldTeacherPresenter : '';
    const uploaded = data.students.filter(s => s.papers.length).length;
    const slidesUploaded = data.students.filter(s=>s.presentations?.length).length;
    $('catalog-status').textContent = `共 ${data.students.length} 位同學・文章 ${uploaded} 位・簡報 ${slidesUploaded} 位${data.syncedAt ? `・更新 ${formatTime(data.syncedAt, true)}` : ''}`;
    renderArticles();
    renderUploadExisting();
    if (pair && (!preserve || state.presenter !== oldPresenter || state.reviewer !== oldReviewer)) await loadPair();
  } finally { state.loading = false; updateControls(); }
}

async function enterClassroom() {
  const hadDraft = state.authenticatedBefore && dirty() && pairIsValid();
  await loadCatalog();
  state.authenticatedBefore = true;
  $('gate').hidden = true; $('classroom').hidden = false; $('logout').hidden = false;
  $('class-code').value = '';
  showViewNow('home');
  if (hadDraft) message('feedback-status', '已重新連線。為保護隱私，建議與心得欄位已清空；如需保留先前文字，請先複製。');
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('login-button').disabled = true;
  message('login-status', '正在確認課程通關碼…');
  try {
    const data = await api('/api/session', { method: 'POST', body: JSON.stringify({ code: $('class-code').value }) });
    storeToken(data.token);
    await enterClassroom();
    $('presenter').focus();
  } catch (error) { message('login-status', error.message, 'error'); }
  finally { $('login-button').disabled = false; }
});

for (const id of ['presenter', 'reviewer']) {
  $(id).addEventListener('change', async () => {
    const next = $(id).value;
    if (dirty()) {
      // Keep the visible identity matched to the retained text while confirmation is open.
      $(id).value = state[id];
      if (!await confirmDiscard('目前的建議或心得尚未儲存。返回後可繼續填寫並儲存；選擇放棄修改，才會切換到另一位同學。')) return;
      $(id).value = next;
    }
    state[id] = next;
    globalStatus(); renderArticles(); await loadPair();
  });
}

for (const id of ['suggestion', 'takeaway']) {
  $(id).addEventListener('input', () => {
    updateControls();
    if (dirty()) message('feedback-status', '內容尚未儲存，請按下方「儲存建議與心得」。');
  });
}

$('save').addEventListener('click', async () => {
  if ($('save').disabled) return;
  const presenter = state.presenter, reviewer = state.reviewer;
  const content = $('suggestion').value, takeaway = $('takeaway').value;
  state.saving = true; updateControls(); $('save').querySelector('span').textContent = '正在儲存…';
  message('feedback-status', '正在儲存，請稍候…');
  try {
    const saved = await api('/api/feedback', { method: 'PUT', body: JSON.stringify({ presenter, reviewer, content, takeaway }) });
    state.originalContent = content; state.originalTakeaway = takeaway; state.revision = saved.revision || 0;
    message('feedback-status', `已儲存並確認・${formatTime(saved.updatedAt)}。再次儲存會覆蓋本次內容。`, 'success');
  } catch (error) {
    message('feedback-status', error.message, 'error');
    if (!error.status || error.status >= 500) {
      message('feedback-status', '連線中斷，尚未確認是否儲存成功。請先複製文字，再重新操作。', 'error');
    }
    authError(error);
  } finally {
    state.saving = false; updateControls(); $('save').querySelector('span').textContent = '儲存建議與心得';
  }
});

$('progress-student').addEventListener('change', () => loadProgress());
$('progress-reload').addEventListener('click', () => loadProgress());
$('received-student').addEventListener('change', () => loadReceived());
$('received-reload').addEventListener('click', () => loadReceived());

$('teacher-presenter').addEventListener('change', () => loadTeacherFeedback());

$('teacher-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.teacherLoading) return;
  const username = $('teacher-username').value.trim();
  const password = $('teacher-password').value;
  if (!username || !password) {
    message('teacher-login-status', '請輸入教師帳號與密碼。', 'error');
    return;
  }
  state.teacherLoading = true;
  updateControls();
  const button = $('teacher-login-button');
  button.textContent = '登入中…';
  message('teacher-login-status', '正在確認教師帳號與密碼…');
  try {
    const data = await api('/api/teacher/session', { method: 'POST', body: JSON.stringify({ username, password }) });
    storeTeacherToken(data.token);
    $('teacher-password').value = '';
    showTeacherPanel();
    message('teacher-login-status', '');
  } catch (error) {
    if (error.code === 'TEACHER_LOGIN' || error.code === 'TEACHER_NOT_CONFIGURED' || error.code === 'TEACHER_RATE_LIMIT') {
      message('teacher-login-status', error.message, 'error');
    } else if (!authError(error)) {
      message('teacher-login-status', error.message, 'error');
    }
  } finally {
    state.teacherLoading = false;
    button.textContent = '登入教師管理';
    updateControls();
  }
});

$('teacher-logout').addEventListener('click', async () => {
  if (state.teacherLoading) return;
  state.teacherLoading = true;
  updateControls();
  try { await teacherApi('/api/teacher/session', { method: 'DELETE' }); } catch { /* Local teacher token is cleared regardless. */ }
  state.teacherSeq++;
  state.teacherLoading = false;
  storeTeacherToken('');
  showTeacherLogin('已離開教師管理。');
  updateControls();
});

$('refresh-catalog').addEventListener('click', async () => {
  if (state.saving || state.loading || state.uploading) return;
  state.loading = true; updateControls();
  $('refresh-catalog').textContent = '正在讀取雲端文章…';
  globalStatus('正在讀取 Google 雲端硬碟的最新上傳資料，請稍候…');
  try {
    const result = await api('/api/sync',{method:'POST',timeoutMs:60000});
    await loadCatalog({ preserve: true });
    globalStatus(`雲端資料已更新：${result.papers} 份文章 PDF、${result.presentations} 份簡報。已儲存的建議均保留。`);
  }
  catch (error) { if (!authError(error)) globalStatus(error.message); }
  finally {state.loading = false; updateControls(); $('refresh-catalog').textContent = '更新雲端文章 ↻';}
});

$('paper-file').addEventListener('change', () => {
  state.paperUploadId = crypto.randomUUID();
  const file = $('paper-file').files[0];
  $('paper-filename').textContent = file?.name || '尚未選擇檔案';
  const error = paperFileError(file);
  if (error) {
    message('paper-status', error, 'error');
    $('paper-file').value = '';
    $('paper-filename').textContent = '請重新選擇檔案';
  } else message('paper-status', '送出後會存入「學號 姓名」資料夾，並以「年份_篇名.pdf」保存。');
  updateControls();
});

$('presentation-file').addEventListener('change', () => {
  state.presentationUploadId = crypto.randomUUID();
  const file = $('presentation-file').files[0];
  $('presentation-filename').textContent = file?.name || '尚未選擇檔案';
  const error = presentationFileError(file);
  if (error) {
    message('presentation-status', error, 'error');
    $('presentation-file').value = '';
    $('presentation-filename').textContent = '請重新選擇檔案';
  } else message('presentation-status', '送出後會以你的學號命名，存入「學號 姓名」資料夾。');
  updateControls();
});

$('uploader').addEventListener('change', async () => {
  clearMaterialFiles();
  message('material-status', '已切換身分，正在更新雲端資料…');
  renderUploadExisting();
  await syncStudentMaterials();
  message('material-status', '可只上傳文章或簡報，也可兩項一起送出；再次上傳會覆蓋先前同類檔案。');
});

$('material-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('material-submit').disabled || state.uploading || state.uploadSyncing) return;
  const studentId = $('uploader').value;
  const paper = $('paper-file').files[0];
  const presentation = $('presentation-file').files[0];
  if (!studentId) { message('material-status', '請先選擇自己的學號與姓名。', 'error'); return; }
  const paperError = paper ? paperFileError(paper) : '';
  const presentationError = presentation ? presentationFileError(presentation) : '';
  if (paperError) message('paper-status', paperError, 'error');
  if (presentationError) message('presentation-status', presentationError, 'error');
  if (paperError || presentationError || (!paper && !presentation)) {
    message('material-status', '請依上方提示選擇檔案後再送出。', 'error');
    return;
  }

  state.uploading = true;
  updateControls();
  const button = $('material-submit');
  button.textContent = '上傳中…';
  message('material-status', '正在儲存至 Google 雲端硬碟，請勿關閉頁面…');
  const jobs = [];
  if (paper) jobs.push({ kind: 'paper', file: paper });
  if (presentation) jobs.push({ kind: 'presentation', file: presentation });
  const results = [];
  let unauthorized = false;
  try {
    for (const job of jobs) {
      const isPaper = job.kind === 'paper';
      try {
        const data = await readBase64(job.file);
        let uploadId = isPaper ? state.paperUploadId : state.presentationUploadId;
        if (!uploadId) {
          uploadId = crypto.randomUUID();
          if (isPaper) state.paperUploadId = uploadId;
          else state.presentationUploadId = uploadId;
        }
        const result = await api(isPaper ? '/api/papers' : '/api/presentations', {
          method: 'POST',
          body: JSON.stringify({ studentId, filename: job.file.name, data, uploadId }),
          timeoutMs: 65000,
        });
        if (isPaper) {
          $('paper-file').value = '';
          $('paper-filename').textContent = '尚未選擇檔案';
          state.paperUploadId = '';
          message('paper-status', `已儲存 ${result.filename}。${result.indexed ? '' : '文章清單尚未更新，請稍後按「更新雲端文章」。'}`, 'success');
        } else {
          $('presentation-file').value = '';
          $('presentation-filename').textContent = '尚未選擇檔案';
          state.presentationUploadId = '';
          message('presentation-status', `已儲存 ${result.filename}。${result.indexed ? '' : '簡報清單尚未更新，請稍後按「更新雲端文章」。'}`, 'success');
        }
        results.push({ kind: job.kind, ok: true, name: result.filename });
      } catch (error) {
        message(isPaper ? 'paper-status' : 'presentation-status', error.message, 'error');
        results.push({ kind: job.kind, ok: false });
        if (authError(error)) { unauthorized = true; break; }
      }
    }
    if (unauthorized) {
      message('material-status', '課程連線已到期，請重新輸入通關碼。', 'error');
      return;
    }
    if (results.some(result => result.ok)) {
      try { await loadCatalog({ preserve: true, pair: false }); }
      catch { message('material-status', '檔案已送出，但畫面清單尚未更新。請稍後重新選擇身分或按「更新雲端文章」。', 'error'); }
      renderUploadExisting();
    }
    if (results.every(result => result.ok)) message('material-status', '本次選擇的檔案已送出。', 'success');
    else if (results.some(result => result.ok)) message('material-status', '部分檔案已送出；未成功的項目保留在畫面上，可修正後重試。', 'error');
    else message('material-status', '檔案尚未送出，請依上方提示修正後重試。', 'error');
  } finally {
    state.uploading = false;
    button.innerHTML = '送出 <span aria-hidden="true">→</span>';
    updateControls();
  }
});

$('logout').addEventListener('click', async () => {
  const hasMaterials = $('paper-file').files.length || $('presentation-file').files.length;
  const prompt = hasMaterials && !dirty()
    ? '目前選擇的檔案尚未送出。選擇放棄後會離開課程，需要時請重新選擇檔案。'
    : '建議或心得尚未儲存。返回後可先完成儲存；選擇放棄修改，才會離開課程。';
  if ((dirty() || hasMaterials) && !await confirmDiscard(prompt)) return;
  state.controller?.abort(); state.loadSeq++; state.uploadLookupSeq++; state.progressSeq++; state.receivedSeq++; state.teacherSeq++;
  state.progressController?.abort(); state.receivedController?.abort();
  let logoutFailed = false;
  if (state.teacherToken) {
    try { await teacherApi('/api/teacher/session', { method: 'DELETE' }); } catch { /* Expired teacher sessions are cleared locally. */ }
  }
  try { await api('/api/session', { method: 'DELETE' }); } catch { logoutFailed = true; }
  storeToken(''); storeTeacherToken('');
  state.students = []; state.originalContent = ''; state.originalTakeaway = ''; state.revision = 0; state.presenter = ''; state.reviewer = ''; state.ready = false; state.authenticatedBefore = false;
  state.uploadSyncing = false; state.teacherLoading = false;
  $('suggestion').value = ''; $('takeaway').value = '';
  $('presenter').replaceChildren(new Option('請選擇報告者的學號與姓名', ''));
  $('reviewer').replaceChildren(new Option('請選擇填寫者的學號與姓名', ''));
  $('uploader').replaceChildren(new Option('請選擇自己的學號與姓名',''));
  $('progress-student').replaceChildren(new Option('請選擇自己的學號與姓名',''));
  $('progress-list').replaceChildren();
  $('received-student').replaceChildren(new Option('請選擇自己的學號與姓名',''));
  $('received-text').value = ''; $('received-count').textContent = '';
  $('teacher-presenter').replaceChildren(new Option('請選擇報告者的學號與姓名',''));
  $('teacher-feedback').replaceChildren();
  showTeacherLogin('請輸入教師帳號與密碼。');
  clearMaterialFiles();
  renderArticles(); renderUploadExisting(); updateControls();
  $('gate').hidden = false; $('classroom').hidden = true; $('logout').hidden = true;
  showViewNow('home');
  message('login-status', logoutFailed ? '已清除此裝置的連線。伺服器未確認登出，原連線最晚於 12 小時後到期。' : '已離開課程。需要時可再次輸入通關碼。');
  $('class-code').focus();
});

addEventListener('beforeunload', event => { if (dirty() || state.saving || state.uploading) { event.preventDefault(); event.returnValue = ''; } });

if (state.token) {
  message('login-status', '正在恢復課程連線…');
  $('login-button').disabled = true;
  enterClassroom().catch(error => { if (error.status === 401) storeToken(''); message('login-status', error.status === 401 ? '請重新輸入老師提供的課程通關碼。' : error.message, 'error'); })
    .finally(() => { $('login-button').disabled = false; });
}
