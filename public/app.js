const $ = id => document.getElementById(id);
const API = (globalThis.SEMINAR_CONFIG?.apiBase || '').replace(/\/$/, '');
const TOKEN_KEY = 'seminar-1151-session';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const VIEWS = ['home', 'upload', 'feedback'];
const PAPER_NAME = /^\d{4}_.+\.pdf$/i;
const state = { token: '', students: [], presenter: '', reviewer: '', original: '', revision: 0, ready: false, saving: false, loading: false, uploading: false, uploadSyncing: false, paperUploadId: '', presentationUploadId: '', loadSeq: 0, uploadLookupSeq: 0, controller: null, authenticatedBefore: false, view: 'home' };
try { state.token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { /* Private browsing may restrict storage; the in-memory session still works. */ }
const dirty = () => $('suggestion').value !== state.original;
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
  if (view === 'upload') renderUploadExisting();
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
    const leave = await confirmDiscard('目前的建議尚未儲存。仍要離開這個頁面嗎？返回後可繼續填寫，建議不會自動儲存。');
    if (!leave) { history.replaceState(null, '', '#feedback'); return; }
  }
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
      throw Object.assign(new Error(data.error || '暫時無法連線，請稍後再試。'), { status: response.status });
    }
    return options.binary ? response : await response.json();
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function authError(error) {
  if (error.status !== 401 || !state.authenticatedBefore) return false;
  $('gate').hidden = false;
  $('classroom').hidden = true;
  $('logout').hidden = true;
  message('login-status', '課程連線已到期，請重新輸入通關碼。尚未儲存的文字會暫留在此頁。', 'error');
  $('class-code').focus();
  return true;
}

function setBadge(text, kind = '') {
  $('save-badge').textContent = text;
  $('save-badge').className = `save-badge ${kind}`;
}

function updateControls() {
  $('word-count').textContent = `${$('suggestion').value.length.toLocaleString('zh-TW')} / 5,000`;
  $('save').disabled = !state.ready || state.saving || state.loading || !pairIsValid() || !dirty() || !$('suggestion').value.trim();
  $('suggestion').disabled = !state.ready || state.saving || !pairIsValid();
  $('presenter').disabled = state.saving || state.loading;
  $('reviewer').disabled = state.saving || state.loading;
  $('refresh-catalog').disabled = state.saving || state.loading || state.uploading || state.uploadSyncing;
  $('logout').disabled = state.saving || state.loading || state.uploading;
  const uploadBusy = state.uploading || state.loading || state.uploadSyncing || state.saving;
  $('uploader').disabled = uploadBusy;
  $('paper-file').disabled = uploadBusy;
  $('presentation-file').disabled = uploadBusy;
  $('material-submit').disabled = uploadBusy || !$('uploader').value || (!$('paper-file').files.length && !$('presentation-file').files.length);
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
  if (!/\.pdf$/i.test(file.name) || !PAPER_NAME.test(file.name) || file.name.length > 200 || /[\\/:*?"<>|\u0000-\u001f]/.test(file.name)) {
    return '文章檔名需為「年份_篇名.pdf」，例：2024_綠色行銷對品牌權益的影響.pdf。請重新命名後再選擇。';
  }
  if (!file.size || file.size > MAX_UPLOAD_BYTES) return '文章檔案不可為空，且須在 5 MB 以內。';
  return '';
}

function presentationFileError(file) {
  if (!file) return '請選擇簡報檔。';
  if (!/\.(pptx?|pdf)$/i.test(file.name)) return '簡報檔案需為 PPT、PPTX 或 PDF。';
  if (!file.size || file.size > MAX_UPLOAD_BYTES) return '簡報檔案不可為空，且須在 5 MB 以內。';
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

async function loadPair() {
  const seq = ++state.loadSeq;
  state.controller?.abort();
  state.controller = new AbortController();
  state.ready = false;
  state.original = '';
  state.revision = 0;
  $('suggestion').value = '';
  $('reload-feedback').hidden = true;
  updateControls();
  if (!state.presenter || !state.reviewer) {
    setBadge('尚未開始'); message('feedback-status', '請先選擇報告同學與你自己的身分。'); return;
  }
  if (!pairIsValid()) {
    setBadge('請確認身分'); message('feedback-status', '你是這次的報告者，請選擇其他同學的報告再留下建議。'); return;
  }
  setBadge('讀取中…'); message('feedback-status', '正在確認這組報告者與填寫者的先前建議…');
  const presenter = state.presenter, reviewer = state.reviewer;
  try {
    const data = await api(`/api/feedback?presenter=${encodeURIComponent(presenter)}&reviewer=${encodeURIComponent(reviewer)}`, { signal: state.controller.signal });
    if (seq !== state.loadSeq || presenter !== state.presenter || reviewer !== state.reviewer) return;
    state.original = data.content; state.revision = data.revision; state.ready = true;
    $('suggestion').value = data.content;
    message('feedback-status', data.updatedAt ? `已帶入先前建議・上次儲存 ${formatTime(data.updatedAt)}` : '還沒有儲存過建議。寫下你的觀察，再按下方按鈕儲存。');
    updateControls();
  } catch (error) {
    if (seq !== state.loadSeq || error.name === 'AbortError') return;
    setBadge('尚未讀取');
    message('feedback-status', error.message, 'error'); $('reload-feedback').hidden = false;
    authError(error);
  }
}

async function loadCatalog({ preserve = false, pair = true } = {}) {
  state.loading = true;
  const oldPresenter = state.presenter, oldReviewer = state.reviewer, oldUploader = $('uploader').value;
  updateControls();
  globalStatus();
  try {
    const data = await api('/api/catalog');
    state.students = data.students;
    for (const [id, hint] of [['presenter', '請選擇報告者的學號與姓名'], ['reviewer', '請選擇填寫者的學號與姓名'], ['uploader','請選擇自己的學號與姓名']]) {
      $(id).replaceChildren(new Option(hint, ''));
      for (const student of data.students) $(id).add(new Option(`${student.id} ${student.name}`, student.id));
    }
    state.presenter = data.students.some(s => s.id === oldPresenter) ? oldPresenter : '';
    state.reviewer = data.students.some(s => s.id === oldReviewer) ? oldReviewer : '';
    $('presenter').value = state.presenter; $('reviewer').value = state.reviewer;
    $('uploader').value = data.students.some(s=>s.id === oldUploader) ? oldUploader : '';
    const uploaded = data.students.filter(s => s.papers.length).length;
    const slidesUploaded = data.students.filter(s=>s.presentations?.length).length;
    $('catalog-status').textContent = `共 ${data.students.length} 位同學・文章 ${uploaded} 位・簡報 ${slidesUploaded} 位${data.syncedAt ? `・更新 ${formatTime(data.syncedAt, true)}` : ''}`;
    renderArticles();
    renderUploadExisting();
    if (pair && (!preserve || state.presenter !== oldPresenter || state.reviewer !== oldReviewer)) await loadPair();
  } finally { state.loading = false; updateControls(); }
}

async function enterClassroom() {
  const preserve = state.authenticatedBefore && dirty() && pairIsValid();
  await loadCatalog({ preserve });
  state.authenticatedBefore = true;
  $('gate').hidden = true; $('classroom').hidden = false; $('logout').hidden = false;
  $('class-code').value = '';
  showViewNow('home');
  if (preserve) message('feedback-status', '已重新連線。先前尚未儲存的文字仍保留，請按「儲存我的建議」。');
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
      if (!await confirmDiscard('目前的建議尚未儲存。返回後可繼續填寫並儲存；選擇放棄修改，才會切換到另一位同學。')) return;
      $(id).value = next;
    }
    state[id] = next;
    globalStatus(); renderArticles(); await loadPair();
  });
}

$('suggestion').addEventListener('input', () => {
  updateControls();
  if (dirty()) message('feedback-status', '內容尚未儲存，請按下方「儲存我的建議」。');
});

$('save').addEventListener('click', async () => {
  if ($('save').disabled) return;
  const presenter = state.presenter, reviewer = state.reviewer, content = $('suggestion').value, revision = state.revision;
  state.saving = true; updateControls(); $('save').querySelector('span').textContent = '正在儲存…';
  message('feedback-status', '正在儲存，請稍候…'); $('reload-feedback').hidden = true;
  try {
    const saved = await api('/api/feedback', { method: 'PUT', body: JSON.stringify({ presenter, reviewer, content, revision }) });
    // Read through the API again, so the success indicator reflects durable server data.
    const checked = await api(`/api/feedback?presenter=${encodeURIComponent(presenter)}&reviewer=${encodeURIComponent(reviewer)}`);
    if (checked.content !== content || checked.revision !== saved.revision) throw Object.assign(new Error('資料已在另一個頁面變更。請先複製保留目前文字，再重新讀取。'), { status: 409 });
    state.original = content; state.revision = checked.revision;
    message('feedback-status', `已儲存並確認・${formatTime(checked.updatedAt)}。之後仍可修改並再次儲存。`, 'success');
  } catch (error) {
    message('feedback-status', error.message, 'error');
    if (error.status === 409 || !error.status || error.status >= 500) {
      $('reload-feedback').hidden = false;
      if (error.status !== 409) message('feedback-status', '連線中斷，尚未確認是否儲存成功。請先複製文字，再重新讀取核對。', 'error');
    }
    authError(error);
  } finally {
    state.saving = false; updateControls(); $('save').querySelector('span').textContent = '儲存我的建議';
  }
});

$('reload-feedback').addEventListener('click', async () => {
  if (dirty() && !await confirmDiscard('重新讀取會以資料庫內容取代目前文字。請先複製保留需要的修改，再選擇是否繼續。')) return;
  await loadPair();
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
  if ($('paper-file').files.length || $('presentation-file').files.length) {
    clearMaterialFiles();
    message('material-status', '已切換身分，請重新選擇要上傳的檔案。');
  }
  renderUploadExisting();
  await syncStudentMaterials();
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
          message('paper-status', `已上傳 ${result.filename}。${result.indexed ? '' : '文章清單尚未更新，請稍後按「更新雲端文章」。'}`, 'success');
        } else {
          $('presentation-file').value = '';
          $('presentation-filename').textContent = '尚未選擇檔案';
          state.presentationUploadId = '';
          message('presentation-status', `已上傳 ${result.filename}。${result.indexed ? '' : '簡報清單尚未更新，請稍後按「更新雲端文章」。'}`, 'success');
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
    : '建議尚未儲存。返回後可先完成儲存；選擇放棄修改，才會離開課程。';
  if ((dirty() || hasMaterials) && !await confirmDiscard(prompt)) return;
  state.controller?.abort(); state.loadSeq++; state.uploadLookupSeq++;
  let logoutFailed = false;
  try { await api('/api/session', { method: 'DELETE' }); } catch { logoutFailed = true; }
  storeToken(''); state.students = []; state.original = ''; state.revision = 0; state.presenter = ''; state.reviewer = ''; state.ready = false; state.authenticatedBefore = false;
  state.uploadSyncing = false;
  $('suggestion').value = '';
  $('presenter').replaceChildren(new Option('請選擇報告者的學號與姓名', ''));
  $('reviewer').replaceChildren(new Option('請選擇填寫者的學號與姓名', ''));
  $('uploader').replaceChildren(new Option('請選擇自己的學號與姓名',''));
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
