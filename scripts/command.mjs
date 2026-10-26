import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = resolve(root, '.private');
mkdirSync(privateDir, { recursive: true });
export function command(executable, args, { input, show = true } = {}) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1', WRANGLER_SEND_METRICS: 'false' }, windowsHide: true });
  if (result.status !== 0) {
    writeFileSync(resolve(privateDir, 'command-error.txt'), `${result.error || ''}\n${result.stdout || ''}\n${result.stderr || ''}`, 'utf8');
    throw new Error('操作未完成，診斷已存於 .private/command-error.txt；請確認目前狀態後再繼續。');
  }
  if (show && result.stdout?.trim()) console.log(result.stdout.trim());
  return result.stdout;
}
