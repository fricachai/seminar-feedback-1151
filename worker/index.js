import { refreshCatalog, readDrivePdf, uploadPresentation, uploadPaper, readDrivePresentation } from './drive.js';
import { validatePresentation, MAX_PRESENTATION_BYTES } from './presentations.js';
import { validatePaper, MAX_PAPER_BYTES } from './papers.js';
const encoder = new TextEncoder();
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_CONTENT = 3000;
const MAX_TAKEAWAY = 3000;
const MAX_TEACHER_ATTEMPTS = 8;

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

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
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
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(raw)) throw httpError(401, '請先輸入課程通關碼。', 'CLASS_AUTH');
  const tokenHash = await digest(raw.slice(7));
  const session = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    throw httpError(401, '課程連線已到期，請重新輸入通關碼。', 'CLASS_AUTH');
  }
  return tokenHash;
}

async function authenticateTeacher(request, env) {
  const raw = request.headers.get('X-Teacher-Token') || '';
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(raw)) throw httpError(401, '請先登入教師管理。', 'TEACHER_AUTH');
  const tokenHash = await digest(raw.slice(7));
  const session = await env.DB.prepare('SELECT expires_at FROM teacher_sessions WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    throw httpError(401, '教師連線已到期，請重新登入。', 'TEACHER_AUTH');
  }
  return tokenHash;
}

function teacherConfigured(env) {
  return typeof env.TEACHER_USERNAME === 'string' && env.TEACHER_USERNAME.length > 0 &&
    /^[a-f0-9]{64}$/.test(env.TEACHER_PASSWORD_HASH || '');
}

async function teacherLogin(request, env, ctx) {
  if (!teacherConfigured(env)) throw httpError(503, '教師登入尚未設定，請由管理者設定帳號與密碼。', 'TEACHER_NOT_CONFIGURED');
  const data = await bodyJSON(request, 2048);
  if (typeof data.username !== 'string' || typeof data.password !== 'string' ||
    !data.username || !data.password || data.username.length > 100 || data.password.length > 200) {
    throw httpError(400, '請輸入教師帳號與密碼。');
  }
  const now = Math.floor(Date.now() / 1000);
  const ipKey = await digest(`teacher:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  const limit = await env.DB.prepare('SELECT count, window_end FROM login_limits WHERE key = ?').bind(ipKey).first();
  if (limit && limit.window_end > now && limit.count >= MAX_TEACHER_ATTEMPTS) {
    return json({ error: '嘗試次數較多，請稍候 15 分鐘再試。', code: 'TEACHER_RATE_LIMIT' }, 429, { 'Retry-After': String(limit.window_end - now) });
  }
  const usernameOk = data.username === env.TEACHER_USERNAME;
  const passwordOk = equalHash(await digest(data.password), env.TEACHER_PASSWORD_HASH);
  if (!usernameOk || !passwordOk) {
    await env.DB.prepare(`INSERT INTO login_limits (key, count, window_end) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN login_limits.window_end <= ? THEN 1 ELSE login_limits.count + 1 END,
        window_end = CASE WHEN login_limits.window_end <= ? THEN excluded.window_end ELSE login_limits.window_end END`)
      .bind(ipKey, now + 900, now, now).run();
    throw httpError(401, '教師帳號或密碼不正確。', 'TEACHER_LOGIN');
  }
  const token = createToken();
  const expiresAt = now + SESSION_SECONDS;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO teacher_sessions (token_hash, expires_at) VALUES (?, ?)').bind(await digest(token), expiresAt),
    env.DB.prepare('DELETE FROM login_limits WHERE key = ?').bind(ipKey),
  ]);
  ctx.waitUntil(env.DB.batch([
    env.DB.prepare('DELETE FROM teacher_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_limits WHERE window_end <= ?').bind(now),
  ]));
  return json({ token, expiresAt });
}

async function teacherLogout(request, env) {
  const tokenHash = await authenticateTeacher(request, env);
  await env.DB.prepare('DELETE FROM teacher_sessions WHERE token_hash = ?').bind(tokenHash).run();
  return json({ ok: true });
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
  const token = createToken();
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

async function feedbackMeta(env, presenter, reviewer) {
  const row = await env.DB.prepare(`SELECT revision, updated_at AS updatedAt FROM feedback
    WHERE class_id = ? AND presenter_id = ? AND reviewer_id = ?`)
    .bind(env.CLASS_ID, presenter, reviewer).first();
  return { exists: Boolean(row), revision: row?.revision || 0, updatedAt: row?.updatedAt || null };
}

async function presenterFeedback(env, presenter) {
  if (!/^\d{8}$/.test(presenter || '')) throw httpError(400, '請選擇報告者。');
  const student = await env.DB.prepare('SELECT id FROM students WHERE active = 1 AND id = ?').bind(presenter).first();
  if (!student) throw httpError(400, '學生資料已更新，請重新整理名單。');
  const rows = await env.DB.prepare(`SELECT f.content FROM feedback f JOIN students s ON s.id = f.reviewer_id
    WHERE f.class_id = ? AND f.presenter_id = ? AND s.active = 1 AND length(trim(f.content)) > 0
    ORDER BY f.updated_at, f.reviewer_id`).bind(env.CLASS_ID, presenter).all();
  const suggestions = rows.results.map(row => row.content);
  return json({ suggestions, count: suggestions.length });
}

async function studentProgress(env, reviewer) {
  if (!/^\d{8}$/.test(reviewer || '')) throw httpError(400, '請選擇自己的學號與姓名。');
  const student = await env.DB.prepare('SELECT id FROM students WHERE active = 1 AND id = ?').bind(reviewer).first();
  if (!student) throw httpError(400, '學生資料已更新，請重新整理名單。');
  const rows = await env.DB.prepare(`SELECT f.presenter_id AS presenterId, s.name AS presenterName,
    CASE WHEN length(trim(f.content)) > 0 THEN 1 ELSE 0 END AS hasSuggestion,
    CASE WHEN length(trim(f.takeaway)) > 0 THEN 1 ELSE 0 END AS hasTakeaway
    FROM feedback f JOIN students s ON s.id = f.presenter_id
    WHERE f.class_id = ? AND f.reviewer_id = ? AND s.active = 1
      AND (length(trim(f.content)) > 0 OR length(trim(f.takeaway)) > 0)
    ORDER BY f.presenter_id`).bind(env.CLASS_ID, reviewer).all();
  return json({ items: rows.results });
}

async function teacherDeleteFeedback(env, presenter, reviewer) {
  if (!/^\d{8}$/.test(presenter || '') || !/^\d{8}$/.test(reviewer || '')) throw httpError(400, '請選擇要刪除的報告者與填寫者。');
  const result = await env.DB.prepare('DELETE FROM feedback WHERE class_id = ? AND presenter_id = ? AND reviewer_id = ?')
    .bind(env.CLASS_ID, presenter, reviewer).run();
  return json({ ok: true, deleted: result.meta.changes });
}

async function teacherFeedback(env, presenter) {
  if (!/^\d{8}$/.test(presenter || '')) throw httpError(400, '請選擇報告者。');
  const student = await env.DB.prepare('SELECT id FROM students WHERE active = 1 AND id = ?').bind(presenter).first();
  if (!student) throw httpError(400, '學生資料已更新，請重新整理名單。');
  const rows = await env.DB.prepare(`SELECT f.reviewer_id AS reviewerId, s.name AS reviewerName,
    f.content, f.takeaway, f.updated_at AS updatedAt FROM feedback f JOIN students s ON s.id = f.reviewer_id
    WHERE f.class_id = ? AND f.presenter_id = ? AND s.active = 1
    ORDER BY f.reviewer_id`).bind(env.CLASS_ID, presenter).all();
  return json({ presenterId: presenter, feedback: rows.results });
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'seminar-feedback', version: '1.7.0' });
  if (path === '/api/session' && request.method === 'POST') return login(request, env, ctx);
  // No public asset fallback: raw hashes, directory paths, and all PDF URLs require authentication.
  if (!path.startsWith('/api/')) throw httpError(404, '找不到此頁面。');
  const tokenHash = await authenticate(request, env);
  if (path === '/api/session' && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return json({ ok: true });
  }
  if (path === '/api/sync' && request.method === 'POST') return json(await refreshCatalog(env));
  if (path === '/api/presenter-feedback' && request.method === 'GET') return presenterFeedback(env, url.searchParams.get('presenter'));
  if (path === '/api/student-progress' && request.method === 'GET') return studentProgress(env, url.searchParams.get('reviewer'));
  if (path === '/api/teacher/session' && request.method === 'POST') return teacherLogin(request, env, ctx);
  if (path === '/api/teacher/session' && request.method === 'DELETE') return teacherLogout(request, env);
  if (path === '/api/teacher/feedback' && request.method === 'GET') {
    await authenticateTeacher(request, env);
    return teacherFeedback(env, url.searchParams.get('presenter'));
  }
  if (path === '/api/teacher/feedback' && request.method === 'DELETE') {
    await authenticateTeacher(request, env);
    return teacherDeleteFeedback(env, url.searchParams.get('presenter'), url.searchParams.get('reviewer'));
  }
  if (path === '/api/papers' && request.method === 'POST') {
    const payload = validatePaper(await bodyJSON(request, Math.ceil(MAX_PAPER_BYTES / 3) * 4 + 4096));
    const student = await env.DB.prepare('SELECT id FROM students WHERE active = 1 AND id = ?').bind(payload.studentId).first();
    if (!student) throw httpError(400,'學生資料已更新，請重新整理名單。');
    return json(await uploadPaper(env,payload));
  }
  if (path === '/api/presentations' && request.method === 'POST') {
    const payload = validatePresentation(await bodyJSON(request, Math.ceil(MAX_PRESENTATION_BYTES / 3) * 4 + 4096));
    const student = await env.DB.prepare('SELECT id FROM students WHERE active = 1 AND id = ?').bind(payload.studentId).first();
    if (!student) throw httpError(400,'學生資料已更新，請重新整理名單。');
    return json(await uploadPresentation(env,payload));
  }
  if (path === '/api/catalog' && request.method === 'GET') {
    const [students, papers, synced, presentations] = await env.DB.batch([
      env.DB.prepare('SELECT id, name FROM students WHERE active = 1 ORDER BY id'),
      env.DB.prepare(`SELECT p.id, p.student_id AS studentId, p.title, p.filename, p.byte_size AS byteSize,
        p.modified_at AS modifiedAt FROM papers p JOIN students s ON s.id = p.student_id
        WHERE p.active = 1 AND s.active = 1 ORDER BY p.modified_at DESC, p.id`),
      env.DB.prepare("SELECT value FROM metadata WHERE key = 'synced_at'"),
      env.DB.prepare(`SELECT p.id, p.student_id AS studentId, p.filename, p.mime_type AS mimeType, p.byte_size AS byteSize,
        p.modified_at AS modifiedAt FROM presentations p JOIN students s ON s.id = p.student_id
        WHERE p.active = 1 AND s.active = 1 ORDER BY p.modified_at DESC, p.id DESC`),
    ]);
    return json({
      students: students.results.map(s => ({ ...s, papers: papers.results.filter(p => p.studentId === s.id), presentations: presentations.results.filter(p => p.studentId === s.id) })),
      syncedAt: synced.results[0]?.value || null,
    });
  }
  const presentationMatch = path.match(/^\/api\/presentations\/([a-f0-9]{24})$/);
  if (presentationMatch && request.method === 'GET') {
    const p = await env.DB.prepare(`SELECT p.filename, p.mime_type, p.drive_file_id FROM presentations p JOIN students s ON s.id = p.student_id
      WHERE p.id = ? AND p.active = 1 AND s.active = 1`).bind(presentationMatch[1]).first();
    if (!p) throw httpError(404,'找不到這份簡報，請更新雲端資料後再試。');
    return new Response(await readDrivePresentation(env,p.drive_file_id,p.mime_type), {headers:{
      'Content-Type':p.mime_type,
      'Content-Disposition':`attachment; filename="presentation.${p.filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(p.filename).replaceAll("'",'%27')}`,
    }});
  }
  if (path === '/api/feedback' && request.method === 'GET') {
    const presenter = url.searchParams.get('presenter');
    const reviewer = url.searchParams.get('reviewer');
    await validPair(env, presenter, reviewer);
    return json(await feedbackMeta(env, presenter, reviewer));
  }
  if (path === '/api/feedback' && request.method === 'PUT') {
    const data = await bodyJSON(request);
    await validPair(env, data.presenter, data.reviewer);
    const content = typeof data.content === 'string' ? data.content : '';
    const takeaway = typeof data.takeaway === 'string' ? data.takeaway : '';
    if (content.length > MAX_CONTENT || takeaway.length > MAX_TAKEAWAY || content.includes('\u0000') || takeaway.includes('\u0000')) {
      throw httpError(400, '建議與心得各限 3,000 字，且不可包含控制字元。');
    }
    if (!content.trim() || !takeaway.trim()) throw httpError(400, '請同時填寫建議與心得，兩欄都不可空白。');
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO feedback (class_id, presenter_id, reviewer_id, content, takeaway, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(class_id, presenter_id, reviewer_id) DO UPDATE SET
        content = excluded.content,
        takeaway = excluded.takeaway,
        revision = feedback.revision + 1,
        updated_at = excluded.updated_at`)
      .bind(env.CLASS_ID, data.presenter, data.reviewer, content, takeaway, updatedAt).run();
    return json({ ok: true, ...(await feedbackMeta(env, data.presenter, data.reviewer)) });
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
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Teacher-Token';
      headers['Access-Control-Expose-Headers'] = 'Content-Disposition';
    }
    let response;
    try {
      if (!allowed) throw httpError(403, '此網站來源未獲允許。');
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env, ctx);
    } catch (error) {
      response = json({ error: error.status ? error.message : '暫時無法連線，請稍後再試；尚未儲存的文字請先保留。', ...(error.code ? { code: error.code } : {}) }, error.status || 500);
    }
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
    return secured;
  },
};
