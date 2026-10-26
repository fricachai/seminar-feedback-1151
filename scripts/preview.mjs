import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:8788');
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
      res.end(`globalThis.SEMINAR_CONFIG=${JSON.stringify({ apiBase: process.env.SEMINAR_API || 'http://127.0.0.1:8787' })};`); return;
    }
    const target = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const file = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(file);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(8788, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:8788'));
