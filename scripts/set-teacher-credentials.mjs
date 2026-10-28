import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './command.mjs';

const username = process.env.TEACHER_USERNAME || '';
const password = process.env.TEACHER_PASSWORD || '';
if (!username || username.length > 100) {
  console.error('Set TEACHER_USERNAME (1-100 characters) before running this script.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Set TEACHER_PASSWORD (at least 12 characters) before running this script.');
  process.exit(1);
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const passwordHash = createHash('sha256').update(password, 'utf8').digest('hex');

// Values are sent through stdin and are never printed or written to the repository.
command(process.execPath, [wrangler, 'secret', 'put', 'TEACHER_USERNAME'], { input: `${username}\n` });
command(process.execPath, [wrangler, 'secret', 'put', 'TEACHER_PASSWORD_HASH'], { input: `${passwordHash}\n` });

console.log(JSON.stringify({ ok: true, usernameSet: true, passwordHashSet: true, hint: 'Remove TEACHER_PASSWORD from the shell environment.' }));