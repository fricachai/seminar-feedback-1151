const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = value => crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value).then(hex);
const fail = (status, message) => Object.assign(new Error(message), { status });

async function bridge(env, op, fileId = '') {
  if (!env.DRIVE_BRIDGE_URL || !env.DRIVE_BRIDGE_SECRET) throw fail(503, '雲端文章串接尚未啟用，請聯絡老師。');
  const url = new URL(env.DRIVE_BRIDGE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw fail(503, '雲端文章串接設定有誤，請聯絡老師。');
  const timestamp = Date.now(), nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.DRIVE_BRIDGE_SECRET), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode([timestamp,op,fileId,nonce].join(':'))));
  const response = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({op,fileId,timestamp,nonce,signature}),
    redirect:'follow', signal:AbortSignal.timeout(45000),
  });
  if (!response.ok) throw fail(503, '暫時無法連線到 Google 雲端硬碟，請稍後再試。');
  const data = await response.json().catch(() => null);
  if (!data?.ok) throw fail(503, 'Google 雲端硬碟暫時無法讀取，原有資料與建議均已保留。');
  return data;
}

export async function refreshCatalog(env) {
  const owner = crypto.randomUUID(), now = Date.now();
  const lock = await env.DB.prepare(`INSERT INTO sync_locks(id,owner,expires_at) VALUES(1,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
    WHERE sync_locks.expires_at <= ? RETURNING owner`).bind(owner,now+65000,now).first();
  if (lock?.owner !== owner) throw fail(409, '目前有人正在更新雲端文章，請稍候片刻再試。');
  try {
    const data = await bridge(env, 'catalog');
    if (!data.complete || !Array.isArray(data.students) || !data.students.length || data.students.length > 500 || !Array.isArray(data.papers) || data.papers.length > 1000) throw fail(502, '雲端名單不完整，未取代原有資料。');
    const ids = new Set();
    for (const s of data.students) {
      if (!/^\d{8}$/.test(s.id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 || ids.has(s.id)) throw fail(502, '雲端名單有待確認的資料，未套用更新。');
      ids.add(s.id);
    }
    const fileIds = new Set(), prepared = [];
    for (const p of data.papers) {
      const unique = `${p.studentId}:${p.driveFileId}`;
      if (!ids.has(p.studentId) || !/^[A-Za-z0-9_-]{10,200}$/.test(p.driveFileId || '') || fileIds.has(unique) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 1000 || !Number.isSafeInteger(p.byteSize) || p.byteSize < 5 || p.byteSize > 10485760 || !Number.isFinite(Date.parse(p.modifiedAt))) throw fail(502, '雲端文章資訊不完整，未取代原有資料。');
      fileIds.add(unique);
      prepared.push({...p,id:(await sha256(unique)).slice(0,24)});
    }
    const oldPapers = await env.DB.prepare('SELECT id FROM papers WHERE active = 1').all();
    const old = new Set(oldPapers.results.map(p => p.id));
    const syncedAt = new Date().toISOString();
    const statements = [env.DB.prepare('UPDATE students SET active = 0'),env.DB.prepare('UPDATE papers SET active = 0')];
    for (const s of data.students) statements.push(env.DB.prepare(`INSERT INTO students(id,name,active) VALUES(?,?,1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1`).bind(s.id,s.name.trim()));
    for (const p of prepared) statements.push(env.DB.prepare(`INSERT INTO papers(id,student_id,title,asset_key,sha256,byte_size,modified_at,title_source,active,source_kind,drive_file_id)
      VALUES(?,?,?,'','',?,?,?,1,'drive',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,byte_size=excluded.byte_size,
      modified_at=excluded.modified_at,title_source=excluded.title_source,active=1,source_kind='drive',drive_file_id=excluded.drive_file_id`)
      .bind(p.id,p.studentId,p.title,p.byteSize,p.modifiedAt,p.titleSource || 'student_filename',p.driveFileId));
    statements.push(env.DB.prepare("INSERT INTO metadata(key,value) VALUES('synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(syncedAt));
    await env.DB.batch(statements);
    return {ok:true,syncedAt,students:data.students.length,papers:prepared.length,uploadedStudents:new Set(prepared.map(p=>p.studentId)).size,newPapers:prepared.filter(p=>!old.has(p.id)).length};
  } finally {
    await env.DB.prepare('DELETE FROM sync_locks WHERE id = 1 AND owner = ?').bind(owner).run();
  }
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
