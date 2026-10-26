import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './command.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.private');
mkdirSync(dir, { recursive: true });
const path = resolve(dir, 'classroom-access.txt');
let code;
if (existsSync(path)) {
  code = readFileSync(path, 'utf8').match(/^code=(.+)$/m)?.[1];
  if (!code) throw new Error('既有通關碼檔格式有誤；未覆寫。');
} else {
  code = `S1151-${randomBytes(6).toString('base64url')}`;
  writeFileSync(path, `專題討論（1）課程通關碼\n\ncode=${code}\n\n請只提供給本課程同學，勿公開張貼。\n此為共同通關碼；學生進入後自行選擇姓名，並非個別身分驗證。\n`, { encoding: 'utf8', mode: 0o600 });
}
const hash = createHash('sha256').update(code).digest('hex');
writeFileSync(resolve(root, '.dev.vars'), `CLASS_CODE_HASH=${hash}\nDEV_ORIGINS=true\n`, { encoding: 'utf8', mode: 0o600 });
if (process.argv.includes('--remote')) {
  command(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'CLASS_CODE_HASH'], { input: hash + '\n', show: false });
  console.log('線上通關碼設定完成；未輸出通關碼或雜湊。');
} else console.log('本機通關碼設定完成；請由 .private/classroom-access.txt 查看，勿提交此檔。');
