import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {command} from '../scripts/command.mjs';
import worker from '../worker/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.SEMINAR_TEST_API||'http://127.0.0.1:8787';
const mode=process.env.SEMINAR_TEST_REMOTE==='1'?'--remote':'--local';
const ids=['99990001','99990002','99990003'];
const code=readFileSync(resolve(root,'.private/classroom-access.txt'),'utf8').match(/^code=(.+)$/m)[1];
const tokenHashes=[];
let token,fixtureAdded=false;
const hash=value=>createHash('sha256').update(value).digest('hex');
function sql(query){
 writeFileSync(resolve(root,'.private/test-fixture.sql'),query,'utf8');
 return command(process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB',mode,'--file','.private/test-fixture.sql','--yes','--json'],{show:false});
}
async function api(path,{method='GET',body,auth=true,headers={}}={}){
 return fetch(base+path,{method,headers:{...(auth&&token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
}
async function feedback(presenter=ids[0],reviewer=ids[1]){
 const r=await api(`/api/feedback?presenter=${presenter}&reviewer=${reviewer}`);assert.equal(r.status,200);return r.json();
}
before(async()=>{
 const r=await api('/api/session',{method:'POST',auth:false,body:{code}});assert.equal(r.status,200);
 token=(await r.json()).token;tokenHashes.push(hash(token));
 const sync=await api('/api/sync',{method:'POST'});assert.equal(sync.status,200);
 const stats=await sync.json();assert.equal(stats.students,35);assert.equal(stats.papers,6);
 sql("INSERT INTO students(id,name,active) VALUES('99990001','測試同學甲',1),('99990002','測試同學乙',1),('99990003','測試同學丙',1) ON CONFLICT(id) DO UPDATE SET active=1; DELETE FROM feedback WHERE presenter_id IN ('99990001','99990002','99990003') OR reviewer_id IN ('99990001','99990002','99990003');");
 fixtureAdded=true;
});
after(async()=>{
 if(fixtureAdded)sql("DELETE FROM feedback WHERE presenter_id IN ('99990001','99990002','99990003') OR reviewer_id IN ('99990001','99990002','99990003'); DELETE FROM students WHERE id IN ('99990001','99990002','99990003');");
 for(const tokenHash of tokenHashes)sql(`DELETE FROM sessions WHERE token_hash='${tokenHash}';`);
});

test('課程未設定通關碼時拒絕登入，不存取資料庫',async()=>{
 const r=await worker.fetch(new Request('https://example.test/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"code":"x"}'}),{},{waitUntil(){}});assert.equal(r.status,503);
});
test('未通關不能讀名單、建議、PDF 或執行雲端更新',async()=>{
 for(const path of ['/api/catalog','/api/feedback','/api/papers/'+'a'.repeat(24),'/api/sync']){
  const r=await api(path,{auth:false,method:path.endsWith('sync')?'POST':'GET'});assert.equal(r.status,401);
 }
});
test('不允許其他網站跨來源取得資料',async()=>{
 const r=await api('/api/catalog',{headers:{Origin:'https://untrusted.example'}});assert.equal(r.status,403);assert.equal(r.headers.has('access-control-allow-origin'),false);
});
test('正式網站來源可通過 CORS 預檢',async()=>{
 const r=await api('/api/catalog',{method:'OPTIONS',auth:false,headers:{Origin:'https://fricachai.github.io'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://fricachai.github.io');
});
test('名單與來源一致，未上傳學生的文章陣列為空',async()=>{
 const r=await api('/api/catalog');assert.equal(r.status,200);const data=await r.json();
 const actual=data.students.filter(s=>!ids.includes(s.id));const manifest=JSON.parse(readFileSync(resolve(root,'.private/manifest.json'),'utf8'));
 const actualHash=hash(JSON.stringify(actual.map(({id,name})=>({id,name}))));
 assert.equal(actualHash,hash(JSON.stringify(manifest.students)));
 assert.equal(actual.filter(s=>s.papers.length).length,6);assert.equal(actual.filter(s=>!s.papers.length).length,29);
 assert.equal(r.headers.get('cache-control'),'no-store, private');
});
test('新增建議可以儲存並從資料庫重新讀回，保留引號與換行',async()=>{
 const empty=await feedback();assert.equal(empty.revision,0);assert.equal(empty.content,'');
 const content="[AUTOMATED-VERIFY] 具體觀察：'引號'、換行\n<script>不應執行</script>";
 const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[0],reviewer:ids[1],content,revision:0}});assert.equal(r.status,200);
 const saved=await feedback();assert.equal(saved.content,content);assert.equal(saved.revision,1);assert.ok(saved.updatedAt);
});
test('建議依報告者與填寫者隔離，其他配對不會讀到',async()=>{
 assert.equal((await feedback(ids[0],ids[2])).content,'');assert.equal((await feedback(ids[2],ids[1])).content,'');
});
test('同一配對的並行修改只有一筆成功，另一筆需重新讀取',async()=>{
 const responses=await Promise.all(['更新甲','更新乙'].map(content=>api('/api/feedback',{method:'PUT',body:{presenter:ids[0],reviewer:ids[1],content:'[AUTOMATED-VERIFY] '+content,revision:1}})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal((await feedback()).revision,2);
});
test('新增第二個配對不覆蓋第一個配對',async()=>{
 const first=await feedback();const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[2],reviewer:ids[1],content:'[AUTOMATED-VERIFY] 第二份建議',revision:0}});assert.equal(r.status,200);assert.equal((await feedback()).content,first.content);
});
test('禁止自己對自己填寫、未知學號、空白與過長內容',async()=>{
 const cases=[{presenter:ids[0],reviewer:ids[0],content:'x'},{presenter:'00000000',reviewer:ids[1],content:'x'},{presenter:ids[0],reviewer:ids[1],content:'  '},{presenter:ids[0],reviewer:ids[1],content:'x'.repeat(5001)}];
 for(const c of cases){const r=await api('/api/feedback',{method:'PUT',body:{...c,revision:2}});assert.equal(r.status,400);}
 assert.equal((await feedback()).revision,2);
});
test('過期工作階段不能讀取資料',async()=>{
 const expired=randomBytes(32).toString('base64url'),tokenHash=hash(expired);tokenHashes.push(tokenHash);
 sql(`INSERT INTO sessions(token_hash,expires_at) VALUES('${tokenHash}',1);`);
 const r=await api('/api/catalog',{auth:false,headers:{Authorization:`Bearer ${expired}`}});assert.equal(r.status,401);
});
test('PDF 經通關後下載，內容與原始檔雜湊一致',async()=>{
 const catalog=await(await api('/api/catalog')).json();const paper=catalog.students.flatMap(s=>s.papers)[0];assert.ok(paper);
 const r=await api('/api/papers/'+paper.id);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');
 const bytes=Buffer.from(await r.arrayBuffer());const expected=JSON.parse(readFileSync(resolve(root,'.private/manifest.json'),'utf8')).papers.map(p=>p.sha256);
 assert.equal(expected.includes(hash(bytes)),true);assert.ok(r.headers.get('content-disposition').startsWith('attachment;'));
});
test('直接猜 PDF 路徑或私有目錄無法繞過通關',async()=>{
 for(const path of ['/'+'a'.repeat(64)+'.pdf','/.private/manifest.json','/.dev.vars','/worker/index.js']){const r=await api(path,{auth:false});assert.equal(r.status,404);}
});
test('登出後原工作階段立即失效',async()=>{
 const r=await api('/api/session',{method:'DELETE'});assert.equal(r.status,200);assert.equal((await api('/api/catalog')).status,401);
});
