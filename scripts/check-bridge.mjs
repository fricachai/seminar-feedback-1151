import {readFileSync,writeFileSync} from 'node:fs';
import {createHmac,createHash,randomBytes} from 'node:crypto';
const settings=JSON.parse(readFileSync(new URL('../.private/bridge-settings.json',import.meta.url),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('../.private/manifest.json',import.meta.url),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
async function request(op,fileId=''){
  const timestamp=Date.now(),nonce=randomBytes(16).toString('hex');
  const signature=createHmac('sha256',settings.BRIDGE_SECRET).update([timestamp,op,fileId,nonce].join(':')).digest('hex');
  const response=await fetch(settings.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,fileId,timestamp,nonce,signature}),signal:AbortSignal.timeout(55000)});
  const data=await response.json();
  if(!data.ok)throw new Error('Bridge request failed; no source content printed.');
  return data;
}
const catalog=await request('catalog');
writeFileSync(new URL('../.private/cloud-catalog.json',import.meta.url),JSON.stringify(catalog,null,2),'utf8');
const rosterMatch=sha(JSON.stringify(catalog.students))===sha(JSON.stringify(manifest.students));
if(!rosterMatch)throw new Error('Live roster differs from original workbook.');
const expected=new Set(manifest.papers.map(p=>p.sha256));
let pdfChecks=0;
if(process.argv.includes('--pdf')){
  for(const paper of catalog.papers){
    const data=await request('pdf',paper.driveFileId);
    const bytes=Buffer.from(data.data,'base64'),hash=sha(bytes);
    if(hash!==data.sha256||!expected.has(hash)||bytes.length!==data.byteSize)throw new Error('PDF hash mismatch.');
    pdfChecks++;
  }
}
console.log(JSON.stringify({students:catalog.students.length,papers:catalog.papers.length,liveRosterMatchesWorkbook:rosterMatch,pdfHashesVerified:pdfChecks}));
