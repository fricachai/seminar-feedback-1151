import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {command} from './command.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const path=resolve(root,'.private/bridge-settings.json');
const settings=JSON.parse(readFileSync(path,'utf8'));
if(process.argv[2]&&!process.argv[2].startsWith('--'))settings.url=process.argv[2];
if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(settings.url||''))throw new Error('Provide the verified deployment URL.');
writeFileSync(path,JSON.stringify(settings,null,2),'utf8');
const code=readFileSync(resolve(root,'.private/classroom-access.txt'),'utf8').match(/^code=(.+)$/m)[1];
const secrets={CLASS_CODE_HASH:createHash('sha256').update(code).digest('hex'),DRIVE_BRIDGE_URL:settings.url,DRIVE_BRIDGE_SECRET:settings.BRIDGE_SECRET};
writeFileSync(resolve(root,'.dev.vars'),Object.entries({...secrets,DEV_ORIGINS:'true'}).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{encoding:'utf8',mode:0o600});
if(process.argv.includes('--remote')){
  command(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'secret','bulk'],{input:JSON.stringify(secrets),show:false});
  console.log('Cloudflare bridge and classroom secrets configured. No values printed.');
}else console.log('Local bridge configuration saved. No values printed.');
