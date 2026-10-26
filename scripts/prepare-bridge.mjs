import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '.private');
mkdirSync(dir, { recursive: true });
const configPath = resolve(dir, 'bridge-settings.json');
if (!existsSync(configPath)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Provide the verified course folder ID and roster file ID.');
  writeFileSync(configPath, JSON.stringify({SOURCE_FOLDER_ID:process.argv[2], ROSTER_FILE_ID:process.argv[3], BRIDGE_SECRET:randomBytes(32).toString('hex')}, null, 2), {encoding:'utf8',mode:0o600});
}
const settings = JSON.parse(readFileSync(configPath, 'utf8'));
const code = readFileSync(resolve(root, 'google-apps-script/Code.gs'), 'utf8');
writeFileSync(resolve(dir,'bridge-initial.gs'), code + '\nfunction initializeBridge() {\n  PropertiesService.getScriptProperties().setProperties(' + JSON.stringify(settings) + ');\n  authorizeBridge();\n}\n', {encoding:'utf8',mode:0o600});
console.log('Private bridge configuration prepared. No credentials printed.');
