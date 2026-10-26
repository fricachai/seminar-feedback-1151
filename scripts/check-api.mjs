import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base=process.argv[2]||'http://127.0.0.1:8787';
const code=readFileSync(new URL('../.private/classroom-access.txt',import.meta.url),'utf8').match(/^code=(.+)$/m)[1];
const manifest=JSON.parse(readFileSync(new URL('../.private/manifest.json',import.meta.url),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
let token;
async function api(path,options={}){
 const response=await fetch(base+path,{...options,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(65000)});
 if(!response.ok)throw new Error(`API status ${response.status} for ${path.split('?')[0]}`);
 return options.binary?response:response.json();
}
const login=await api('/api/session',{method:'POST',body:JSON.stringify({code})});token=login.token;
try{
 const result=await api('/api/sync',{method:'POST'});
 const catalog=await api('/api/catalog');
 assert.equal(sha(JSON.stringify(catalog.students.map(({id,name})=>({id,name})))),sha(JSON.stringify(manifest.students)));
 const expected=new Set(manifest.papers.map(p=>p.sha256));let checked=0;
 for(const student of catalog.students)for(const paper of student.papers){
  const response=await api('/api/papers/'+paper.id,{binary:true});
  assert.equal(response.headers.get('content-type'),'application/pdf');
  const buffer=Buffer.from(await response.arrayBuffer());assert.equal(expected.has(sha(buffer)),true);checked++;
 }
 const report={base,liveSync:true,students:catalog.students.length,papers:result.papers,pdfHashesVerified:checked,rosterVerified:true,verifiedAt:new Date().toISOString()};
 writeFileSync(new URL('../.private/api-verification-'+(base.includes('127.0.0.1')?'local':'remote')+'.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await api('/api/session',{method:'DELETE'});}
