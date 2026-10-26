import { refreshCatalog, readDrivePdf } from './drive.js';
const encoder = new TextEncoder();
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_CONTENT = 5000;

export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function equalHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function bodyJSON(request, maxBytes = 40000) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
    throw httpError(415, '請使用正確的資料格式。');
  }
  // Enforce the bound on streamed bytes, including chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw httpError(400, '缺少填寫內容。');
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw httpError(413, '資料過長，請縮短內容後再試。');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw httpError(400, '資料格式有誤，請重新操作。'); }
}

function allowedOrigins(env) {
  const origins = new Set((env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean));
  if (env.DEV_ORIGINS === 'true') {
    origins.add('http://127.0.0.1:8788');
    origins.add('http://localhost:8788');
  }
  return origins;
}

async function authenticate(request, env) {
  const raw = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(raw)) throw httpError(401, '請先輸入課程通關碼。');
  const tokenHash = await digest(raw.slice(7));
  const session = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    throw httpError(401, '課程連線已到期，請重新輸入通關碼。');
  }
  return tokenHash;
}

async function login(request, env, ctx) {
  if (!env.CLASS_CODE_HASH) throw httpError(503, '課程入口尚未啟用，請聯絡老師。');
  const data = await bodyJSON(request, 2048);
  if (typeof data.code !== 'string' || data.code.length > 100) throw httpError(400, '請輸入課程通關碼。');
  const now = Math.floor(Date.now() / 1000);
  const ipKey = await digest(`${env.CLASS_CODE_HASH}:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  const limit = await env.DB.prepare('SELECT count, window_end FROM login_limits WHERE key = ?').bind(ipKey).first();
  if (limit && limit.window_end > now && limit.count >= 10) {
    return json({ error: '嘗試次數較多，請稍候 15 分鐘再試。' }, 429, { 'Retry-After': String(limit.window_end - now) });
  }
  if (!equalHash(await digest(data.code.trim()), env.CLASS_CODE_HASH)) {
    await env.DB.prepare(`INSERT INTO login_limits (key, count, window_end) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN login_limits.window_end <= ? THEN 1 ELSE login_limits.count + 1 END,
        window_end = CASE WHEN login_limits.window_end <= ? THEN excluded.window_end ELSE login_limits.window_end END`)
      .bind(ipKey, now + 900, now, now).run();
    throw httpError(401, '通關碼不正確，請確認老師提供的課程通關碼。');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const expiresAt = now + SESSION_SECONDS;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await digest(token), expiresAt),
    env.DB.prepare('DELETE FROM login_limits WHERE key = ?').bind(ipKey),
  ]);
  ctx.waitUntil(env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_limits WHERE window_end <= ?').bind(now),
  ]));
  return json({ token, expiresAt });
}

async function validPair(env, presenter, reviewer) {
  if (!/^\d{8}$/.test(presenter || '') || !/^\d{8}$/.test(reviewer || '')) {
    throw httpError(400, '請先選擇報告者與填寫者。');
  }
  if (presenter === reviewer) throw httpError(400, '請選擇其他同學的報告，留下同儕建議。');
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM students WHERE active = 1 AND id IN (?, ?)')
    .bind(presenter, reviewer).first();
  if (row.count !== 2) throw httpError(400, '學生資料已更新，請重新整理名單。');
}

async function readFeedback(env, presenter, reviewer) {
  return await env.DB.prepare(`SELECT content, revision, updated_at AS updatedAt FROM feedback
    WHERE class_id = ? AND presenter_id = ? AND reviewer_id = ?`)
    .bind(env.CLASS_ID, presenter, reviewer).first() || { content: '', revision: 0, updatedAt: null };
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'seminar-feedback', version: '1.0.0' });
  if (path === '/api/session' && request.method === 'POST') return login(request, env, ctx);
  // No public asset fallback: raw hashes, directory paths, and all PDF URLs require authentication.
  if (!path.startsWith('/api/')) throw httpError(404, '找不到此頁面。');
  const tokenHash = await authenticate(request, env);
  if (path === '/api/session' && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return json({ ok: true });
  }
  if (path === '/api/sync' && request.method === 'POST') return json(await refreshCatalog(env));
  if (path === '/api/catalog' && request.method === 'GET') {
    const [students, papers, synced] = await env.DB.batch([
      env.DB.prepare('SELECT id, name FROM students WHERE active = 1 ORDER BY id'),
      env.DB.prepare(`SELECT p.id, p.student_id AS studentId, p.title, p.byte_size AS byteSize,
        p.modified_at AS modifiedAt FROM papers p JOIN students s ON s.id = p.student_id
        WHERE p.active = 1 AND s.active = 1 ORDER BY p.modified_at DESC, p.id`),
      env.DB.prepare("SELECT value FROM metadata WHERE key = 'synced_at'"),
    ]);
    return json({
      students: students.results.map(s => ({ ...s, papers: papers.results.filter(p => p.studentId === s.id) })),
      syncedAt: synced.results[0]?.value || null,
    });
  }
  if (path === '/api/feedback' && request.method === 'GET') {
    const presenter = url.searchParams.get('presenter');
    const reviewer = url.searchParams.get('reviewer');
    await validPair(env, presenter, reviewer);
    return json(await readFeedback(env, presenter, reviewer));
  }
  if (path === '/api/feedback' && request.method === 'PUT') {
    const data = await bodyJSON(request);
    await validPair(env, data.presenter, data.reviewer);
    if (typeof data.content !== 'string' || !data.content.trim() || data.content.length > MAX_CONTENT || data.content.includes('\u0000')) {
      throw httpError(400, '請填寫 1 至 5,000 字的建議內容。');
    }
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw httpError(400, '請重新讀取先前建議後再儲存。');
    const updatedAt = new Date().toISOString();
    const result = data.revision === 0
      ? await env.DB.prepare(`INSERT INTO feedback (class_id, presenter_id, reviewer_id, content, revision, updated_at)
          VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(class_id, presenter_id, reviewer_id) DO NOTHING`)
          .bind(env.CLASS_ID, data.presenter, data.reviewer, data.content, updatedAt).run()
      : await env.DB.prepare(`UPDATE feedback SET content = ?, revision = revision + 1, updated_at = ?
          WHERE class_id = ? AND presenter_id = ? AND reviewer_id = ? AND revision = ?`)
          .bind(data.content, updatedAt, env.CLASS_ID, data.presenter, data.reviewer, data.revision).run();
    if (result.meta.changes !== 1) throw httpError(409, '這份建議已在其他頁面更新。請先複製保留目前文字，再重新讀取。');
    return json(await readFeedback(env, data.presenter, data.reviewer));
  }
  const match = path.match(/^\/api\/papers\/([a-f0-9]{24})$/);
  if (match && request.method === 'GET') {
    const paper = await env.DB.prepare(`SELECT p.title, p.asset_key, p.source_kind, p.drive_file_id FROM papers p JOIN students s ON s.id = p.student_id
      WHERE p.id = ? AND p.active = 1 AND s.active = 1`).bind(match[1]).first();
    if (!paper) throw httpError(404, '找不到這份 PDF，請更新雲端文章後再試。');
    if (paper.source_kind !== 'drive') throw httpError(503, '請先按「更新雲端文章」取得這份 PDF 的最新資訊。');
    const body = await readDrivePdf(env,paper.drive_file_id);
    return new Response(body, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="article.pdf"; filename*=UTF-8''${encodeURIComponent(paper.title + '.pdf').replaceAll("'", '%27')}`,
    } });
  }
  throw httpError(404, '找不到此功能。');
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const allowed = !origin || allowedOrigins(env).has(origin);
    const headers = {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Vary': 'Origin',
    };
    if (origin && allowed) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
      headers['Access-Control-Expose-Headers'] = 'Content-Disposition';
    }
    let response;
    try {
      if (!allowed) throw httpError(403, '此網站來源未獲允許。');
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env, ctx);
    } catch (error) {
      response = json({ error: error.status ? error.message : '暫時無法連線，請稍後再試；尚未儲存的文字請先保留。' }, error.status || 500);
    }
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
    return secured;
  },
};
