const $ = id => document.getElementById(id);
const API = (globalThis.SEMINAR_CONFIG?.apiBase || '').replace(/\/$/, '');
const TOKEN_KEY = 'seminar-1151-session';
const state = { token: '', students: [], presenter: '', reviewer: '', original: '', revision: 0, ready: false, saving: false, loading: false, uploading: false, uploadId: '', loadSeq: 0, controller: null, authenticatedBefore: false };
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
  $('refresh-catalog').disabled = state.saving || state.loading || state.uploading;
  $('logout').disabled = state.saving || state.loading || state.uploading;
  $('uploader').disabled = state.uploading || state.loading;
  $('presentation-file').disabled = state.uploading || state.loading;
  $('upload-submit').disabled = state.uploading || state.loading || !$('uploader').value || !$('presentation-file').files.length;
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

async function loadCatalog({ preserve = false } = {}) {
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
    if (!preserve || state.presenter !== oldPresenter || state.reviewer !== oldReviewer) await loadPair();
  } finally { state.loading = false; updateControls(); }
}

async function enterClassroom() {
  const preserve = state.authenticatedBefore && dirty() && pairIsValid();
  await loadCatalog({ preserve });
  state.authenticatedBefore = true;
  $('gate').hidden = true; $('classroom').hidden = false; $('logout').hidden = false;
  $('class-code').value = '';
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

$('presentation-file').addEventListener('change',()=>{
  state.uploadId = crypto.randomUUID();
  const file = $('presentation-file').files[0];
  $('upload-filename').textContent = file?.name || '尚未選擇檔案';
  if (file && (!/\.(pptx?|pdf)$/i.test(file.name) || !file.size || file.size > 5*1024*1024)) {
    message('upload-status','請選擇不超過 5 MB 的 PPT、PPTX 或 PDF 簡報檔。','error');
    $('presentation-file').value = ''; $('upload-filename').textContent = '請重新選擇檔案';
  } else message('upload-status','請確認自己的學號與姓名，檔案會以學號命名儲存。');
  updateControls();
});
$('uploader').addEventListener('change',()=>{state.uploadId = crypto.randomUUID(); updateControls();});
$('upload-form').addEventListener('submit',async event=>{
  event.preventDefault(); if ($('upload-submit').disabled) return;
  const file = $('presentation-file').files[0], studentId = $('uploader').value;
  if (!file || !file.size || file.size > 5*1024*1024 || !/\.(pptx?|pdf)$/i.test(file.name)) {
    message('upload-status','請選擇不超過 5 MB 的 PPT、PPTX 或 PDF 簡報檔。','error'); return;
  }
  state.uploading = true; updateControls(); $('upload-submit').textContent = '上傳中…';
  message('upload-status','正在儲存至 Google 雲端硬碟，請勿關閉頁面…');
  try {
    const data = await new Promise((resolve,reject)=>{
      const reader = new FileReader(); reader.onload = ()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror = ()=>reject(new Error('檔案讀取失敗，請重新選取。')); reader.readAsDataURL(file);
    });
    const result = await api('/api/presentations',{method:'POST',body:JSON.stringify({studentId,filename:file.name,data,uploadId:state.uploadId ||= crypto.randomUUID()}),timeoutMs:65000});
    $('presentation-file').value = ''; $('upload-filename').textContent = '尚未選擇檔案'; state.uploadId = '';
    message('upload-status',`已上傳 ${result.filename} 至對應的學生資料夾。${result.indexed ? '' : '下載清單尚未更新，請按「更新雲端文章」。'}`,'success');
    try {await loadCatalog({preserve:true});}
    catch {message('upload-status',`已上傳 ${result.filename}，畫面清單尚未更新，請稍後按「更新雲端文章」。`,'success');}
  } catch (error) {message('upload-status',error.message,'error'); authError(error);}
  finally {state.uploading = false; $('upload-submit').innerHTML = '送出 <span aria-hidden="true">→</span>'; updateControls();}
});

$('logout').addEventListener('click', async () => {
  if (dirty() && !await confirmDiscard('建議尚未儲存。返回後可先完成儲存；選擇放棄修改，才會離開課程。')) return;
  state.controller?.abort(); state.loadSeq++;
  let logoutFailed = false;
  try { await api('/api/session', { method: 'DELETE' }); } catch { logoutFailed = true; }
  storeToken(''); state.students = []; state.original = ''; state.revision = 0; state.presenter = ''; state.reviewer = ''; state.ready = false; state.authenticatedBefore = false;
  $('suggestion').value = '';
  $('presenter').replaceChildren(new Option('請選擇報告者的學號與姓名', ''));
  $('reviewer').replaceChildren(new Option('請選擇填寫者的學號與姓名', ''));
  $('uploader').replaceChildren(new Option('請選擇自己的學號與姓名',''));
  $('presentation-file').value = ''; $('upload-filename').textContent = '尚未選擇檔案'; state.uploadId = '';
  renderArticles(); updateControls();
  $('gate').hidden = false; $('classroom').hidden = true; $('logout').hidden = true;
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
