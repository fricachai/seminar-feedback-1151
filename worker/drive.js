const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = value => crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value).then(hex);
const fail = (status, message) => Object.assign(new Error(message), { status });

async function bridge(env, op, fileId = '', payload = null) {
  if (!env.DRIVE_BRIDGE_URL || !env.DRIVE_BRIDGE_SECRET) throw fail(503, '雲端文章串接尚未啟用，請聯絡老師。');
  const url = new URL(env.DRIVE_BRIDGE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw fail(503, '雲端文章串接設定有誤，請聯絡老師。');
  const timestamp = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.DRIVE_BRIDGE_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const parts = [timestamp,op,fileId,nonce];
  if (payload) parts.push(await sha256(JSON.stringify(payload)));
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(parts.join(':'))));
  const response = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({op,fileId,timestamp,nonce,signature,...(payload ? {payload} : {})}),
    redirect:'follow', signal:AbortSignal.timeout(45000),
  });
  if (!response.ok) throw fail(503, '暫時無法連線到 Google 雲端硬碟，請稍後再試。');
  const data = await response.json().catch(() => null);
  if (!data?.ok) throw fail(503, op === 'upload' || op === 'upload-paper' ? '尚未確認雲端儲存結果，請保留選取的檔案並重試；相同上傳不會重複建立。' : 'Google 雲端硬碟暫時無法讀取，原有資料與建議均已保留。');
  return data;
}

async function withCatalogLock(env, action) {
  const owner = crypto.randomUUID(), now = Date.now();
  const lock = await env.DB.prepare(`INSERT INTO sync_locks(id,owner,expires_at) VALUES(1,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
    WHERE sync_locks.expires_at <= ? RETURNING owner`).bind(owner,now+65000,now).first();
  if (lock?.owner !== owner) throw fail(409, '目前有人正在更新雲端文章，請稍候片刻再試。');
  try {
    return await action();
  } finally {
    await env.DB.prepare('DELETE FROM sync_locks WHERE id = 1 AND owner = ?').bind(owner).run();
  }
}

function presentationStatement(env, p) {
  return env.DB.prepare(`INSERT INTO presentations(id,student_id,filename,mime_type,byte_size,modified_at,drive_file_id,active)
    VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,mime_type=excluded.mime_type,
    byte_size=excluded.byte_size,modified_at=excluded.modified_at,active=1`)
    .bind(p.id,p.studentId,p.filename,p.mimeType,p.byteSize,p.modifiedAt,p.driveFileId);
}

function paperStatement(env, p) {
  return env.DB.prepare(`INSERT INTO papers(id,student_id,title,filename,asset_key,sha256,byte_size,modified_at,title_source,active,source_kind,drive_file_id)
    VALUES(?,?,?,?,'','',?,?,?,1,'drive',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,filename=excluded.filename,
    byte_size=excluded.byte_size,modified_at=excluded.modified_at,title_source=excluded.title_source,
    active=1,source_kind='drive',drive_file_id=excluded.drive_file_id`)
    .bind(p.id,p.studentId,p.title,p.filename,p.byteSize,p.modifiedAt,p.titleSource,p.driveFileId);
}

async function preparePresentation(p, ids) {
  const types = ['application/pdf','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'];
  if (!p || !ids.has(p.studentId) || !/^[A-Za-z0-9_-]{10,200}$/.test(p.driveFileId || '') || typeof p.filename !== 'string' || p.filename.length > 250 || !/\.(pptx?|pdf)$/i.test(p.filename) || !types.includes(p.mimeType) || !Number.isSafeInteger(p.byteSize) || p.byteSize < 5 || p.byteSize > 5242880 || !Number.isFinite(Date.parse(p.modifiedAt))) throw fail(502,'雲端簡報資訊不完整，未套用更新。');
  return {...p,id:(await sha256(`${p.studentId}:${p.driveFileId}`)).slice(0,24)};
}

async function preparePaper(p, ids) {
  if (!p || !ids.has(p.studentId) || !/^[A-Za-z0-9_-]{10,200}$/.test(p.driveFileId || '') ||
    typeof p.filename !== 'string' || p.filename.length > 200 || !/^\d{4}_.+\.pdf$/i.test(p.filename) ||
    p.mimeType !== 'application/pdf' || !Number.isSafeInteger(p.byteSize) || p.byteSize < 5 || p.byteSize > 5242880 ||
    !Number.isFinite(Date.parse(p.modifiedAt)) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 1000 ||
    typeof p.titleSource !== 'string' || !p.titleSource) throw fail(502,'雲端文章資訊不完整，未套用更新。');
  return {...p,title:p.title.trim(),filename:p.filename,id:(await sha256(`${p.studentId}:${p.driveFileId}`)).slice(0,24)};
}

export async function uploadPresentation(env, payload) {
  return withCatalogLock(env, async () => {
    const result = await bridge(env,'upload','',payload);
    const p = await preparePresentation(result.presentation,new Set([payload.studentId]));
    // The file already exists in Drive: indexing failure must never imply the file was not saved.
    try {
      await env.DB.batch([
        presentationStatement(env,p),
        env.DB.prepare('UPDATE presentations SET active = 0 WHERE student_id = ? AND id <> ?').bind(p.studentId,p.id),
      ]);
    }
    catch { return {ok:true,indexed:false,filename:p.filename}; }
    return {ok:true,indexed:true,filename:p.filename};
  });
}

export async function uploadPaper(env, payload) {
  return withCatalogLock(env, async () => {
    const result = await bridge(env,'upload-paper','',payload);
    const p = await preparePaper(result.paper,new Set([payload.studentId]));
    // The file already exists in Drive: indexing failure must never imply the file was not saved.
    try {
      await env.DB.batch([
        paperStatement(env,p),
        env.DB.prepare('UPDATE papers SET active = 0 WHERE student_id = ? AND id <> ?').bind(p.studentId,p.id),
      ]);
    }
    catch { return {ok:true,indexed:false,filename:p.filename,title:p.title}; }
    return {ok:true,indexed:true,filename:p.filename,title:p.title};
  });
}

export async function refreshCatalog(env) {
  return withCatalogLock(env, async () => {
    const data = await bridge(env, 'catalog');
    if (!data.complete || !Array.isArray(data.students) || !data.students.length || data.students.length > 500 || !Array.isArray(data.papers) || data.papers.length > 1000) throw fail(502, '雲端名單不完整，未取代原有資料。');
    const ids = new Set();
    for (const s of data.students) {
      if (!/^\d{8}$/.test(s.id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 || ids.has(s.id)) throw fail(502, '雲端名單有待確認的資料，未套用更新。');
      ids.add(s.id);
    }
    if (!Array.isArray(data.presentations) || data.presentations.length > 2000) throw fail(502,'雲端簡報索引尚未就緒，未取代原有資料。');
    const presentations = [], presentationIds = new Set();
    for (const item of data.presentations) {
      const p = await preparePresentation(item,ids);
      if (presentationIds.has(p.id)) throw fail(502,'雲端簡報索引重複，未套用更新。');
      presentationIds.add(p.id); presentations.push(p);
    }
    const fileIds = new Set(), prepared = [];
    for (const p of data.papers) {
      const unique = `${p.studentId}:${p.driveFileId}`;
      if (!ids.has(p.studentId) || !/^[A-Za-z0-9_-]{10,200}$/.test(p.driveFileId || '') || fileIds.has(unique) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 1000 || (p.filename != null && (typeof p.filename !== 'string' || p.filename.length > 200)) || !Number.isSafeInteger(p.byteSize) || p.byteSize < 5 || p.byteSize > 10485760 || !Number.isFinite(Date.parse(p.modifiedAt))) throw fail(502, '雲端文章資訊不完整，未取代原有資料。');
      fileIds.add(unique);
      prepared.push({...p,filename:typeof p.filename === 'string' ? p.filename : null,id:(await sha256(unique)).slice(0,24)});
    }
    const oldPapers = await env.DB.prepare('SELECT id FROM papers WHERE active = 1').all();
    const old = new Set(oldPapers.results.map(p => p.id));
    const syncedAt = new Date().toISOString();
    const statements = [env.DB.prepare('UPDATE students SET active = 0'),env.DB.prepare('UPDATE papers SET active = 0'),env.DB.prepare('UPDATE presentations SET active = 0')];
    for (const s of data.students) statements.push(env.DB.prepare(`INSERT INTO students(id,name,active) VALUES(?,?,1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1`).bind(s.id,s.name.trim()));
    for (const p of prepared) statements.push(env.DB.prepare(`INSERT INTO papers(id,student_id,title,filename,asset_key,sha256,byte_size,modified_at,title_source,active,source_kind,drive_file_id)
      VALUES(?,?,?,?,'','',?,?,?,1,'drive',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,filename=excluded.filename,
      byte_size=excluded.byte_size,modified_at=excluded.modified_at,title_source=excluded.title_source,
      active=1,source_kind='drive',drive_file_id=excluded.drive_file_id`)
      .bind(p.id,p.studentId,p.title,p.filename,p.byteSize,p.modifiedAt,p.titleSource || 'student_filename',p.driveFileId));
    for (const p of presentations) statements.push(presentationStatement(env,p));
    statements.push(env.DB.prepare("INSERT INTO metadata(key,value) VALUES('synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(syncedAt));
    await env.DB.batch(statements);
    return {ok:true,syncedAt,students:data.students.length,papers:prepared.length,presentations:presentations.length,uploadedStudents:new Set(prepared.map(p=>p.studentId)).size,newPapers:prepared.filter(p=>!old.has(p.id)).length};
  });
}

export async function readDrivePresentation(env, fileId, mimeType) {
  const data = await bridge(env,'presentation',fileId);
  if (data.mimeType !== mimeType || typeof data.data !== 'string' || data.data.length > 6990508 || !Number.isSafeInteger(data.byteSize) || data.byteSize > 5242880 || !/^[a-f0-9]{64}$/.test(data.sha256 || '')) throw fail(502,'簡報傳輸格式有誤，請重試。');
  let binary;
  try { binary = atob(data.data); } catch { throw fail(502,'簡報傳輸未完成，請重試。'); }
  const bytes = Uint8Array.from(binary,c=>c.charCodeAt(0));
  if (bytes.length !== data.byteSize || await sha256(bytes) !== data.sha256) throw fail(502,'簡報完整性檢查未通過，請重試。');
  return bytes;
}

export async function readDrivePdf(env, fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId || '')) throw fail(404,'找不到這份 PDF。');
  const data = await bridge(env,'pdf',fileId);
  if (typeof data.data !== 'string' || data.data.length > 14000000 || !Number.isSafeInteger(data.byteSize) || data.byteSize > 10485760 || !/^[a-f0-9]{64}$/.test(data.sha256 || '')) throw fail(502,'PDF 傳輸格式有誤，請重試。');
  let binary;
  try { binary = atob(data.data); } catch { throw fail(502,'PDF 傳輸未完成，請重試。'); }
  if (!binary.startsWith('%PDF-') || binary.length !== data.byteSize) throw fail(502,'PDF 完整性檢查未通過，請重試。');
  const bytes = Uint8Array.from(binary, c=>c.charCodeAt(0));
  if (await sha256(bytes) !== data.sha256) throw fail(502,'PDF 完整性檢查未通過，請重試。');
  return bytes;
}
