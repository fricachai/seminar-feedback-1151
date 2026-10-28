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
async function feedbackMeta(presenter=ids[0],reviewer=ids[1]){
 const r=await api(`/api/feedback?presenter=${presenter}&reviewer=${reviewer}`);assert.equal(r.status,200);return r.json();
}
function stored(presenter=ids[0],reviewer=ids[1]){
 const out=sql(`SELECT content,takeaway,revision FROM feedback WHERE presenter_id='${presenter}' AND reviewer_id='${reviewer}';`);
 const rows=JSON.parse(out)[0]?.results || [];
 return rows[0] || null;
}
before(async()=>{
 const r=await api('/api/session',{method:'POST',auth:false,body:{code}});assert.equal(r.status,200);
 token=(await r.json()).token;tokenHashes.push(hash(token));
 if(process.env.SEMINAR_TEST_SKIP_SYNC==='1') {
  assert.equal(mode,'--local','Only isolated local tests may skip cloud sync.');
 } else {
  const sync=await api('/api/sync',{method:'POST'});assert.equal(sync.status,200);
  const stats=await sync.json();assert.equal(stats.students,35);assert.equal(stats.papers,6);
 }
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
test('正式網站來源可通過 CORS 預檢，含教師自訂標頭',async()=>{
 const r=await api('/api/catalog',{method:'OPTIONS',auth:false,headers:{Origin:'https://fricachai.github.io','Access-Control-Request-Headers':'x-teacher-token'}});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'https://fricachai.github.io');assert.match(r.headers.get('access-control-allow-headers'),/X-Teacher-Token/i);
});
test('名單與來源一致，未上傳學生的文章陣列為空',async()=>{
 const r=await api('/api/catalog');assert.equal(r.status,200);const data=await r.json();
 const actual=data.students.filter(s=>!ids.includes(s.id));const manifest=JSON.parse(readFileSync(resolve(root,'.private/manifest.json'),'utf8'));
 const actualHash=hash(JSON.stringify(actual.map(({id,name})=>({id,name}))));
 assert.equal(actualHash,hash(JSON.stringify(manifest.students)));
 assert.equal(actual.filter(s=>s.papers.length).length,6);assert.equal(actual.filter(s=>!s.papers.length).length,29);
 assert.equal(r.headers.get('cache-control'),'no-store, private');
});
test('新增建議可以儲存，公開讀取只回傳是否存在，不帶出建議內容',async()=>{
 const empty=await feedbackMeta();assert.equal(empty.exists,false);assert.equal(empty.revision,0);assert.equal(Object.hasOwn(empty,'content'),false);assert.equal(Object.hasOwn(empty,'takeaway'),false);
 const content="[AUTOMATED-VERIFY] 具體觀察：'引號'、換行\n<script>不應執行</script>";
 const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[0],reviewer:ids[1],content}});assert.equal(r.status,200);
 const saved=await feedbackMeta();assert.equal(saved.exists,true);assert.equal(saved.revision,1);assert.ok(saved.updatedAt);
 const row=stored();assert.equal(row.content,content);assert.equal(row.takeaway,'');
});
test('建議依報告者與填寫者隔離，其他配對不會讀到',async()=>{
 assert.equal(stored(ids[0],ids[2]),null);assert.equal(stored(ids[2],ids[1]),null);
});
test('同一配對再次儲存以最後一次為準，不新增第二筆',async()=>{
 const first=await api('/api/feedback',{method:'PUT',body:{presenter:ids[0],reviewer:ids[1],content:'[AUTOMATED-VERIFY] 更新甲'}});assert.equal(first.status,200);
 const second=await api('/api/feedback',{method:'PUT',body:{presenter:ids[0],reviewer:ids[1],content:'[AUTOMATED-VERIFY] 更新乙'}});assert.equal(second.status,200);
 const row=stored();assert.equal(row.content,'[AUTOMATED-VERIFY] 更新乙');assert.equal(row.revision,3);
 const count=JSON.parse(sql(`SELECT COUNT(*) AS count FROM feedback WHERE presenter_id='${ids[0]}' AND reviewer_id='${ids[1]}';`))[0].results[0].count;assert.equal(count,1);
});
test('新增第二個配對不覆蓋第一個配對',async()=>{
 const first=stored();const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[2],reviewer:ids[1],content:'[AUTOMATED-VERIFY] 第二份建議'}});assert.equal(r.status,200);assert.equal(stored().content,first.content);
});
test('禁止自己對自己填寫、未知學號、空白與過長內容',async()=>{
 const cases=[{presenter:ids[0],reviewer:ids[0],content:'x'},{presenter:'00000000',reviewer:ids[1],content:'x'},{presenter:ids[0],reviewer:ids[1],content:'  '},{presenter:ids[0],reviewer:ids[1],content:'x'.repeat(3001)}];
 for(const c of cases){const r=await api('/api/feedback',{method:'PUT',body:c});assert.equal(r.status,400);}
 assert.equal(stored().revision,3);
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
test('建議與心得可分別儲存，後寫入者覆蓋原內容',async()=>{
 const content='[AUTOMATED-VERIFY] 建議內容', takeaway='[AUTOMATED-VERIFY] 心得內容';
 const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[1],reviewer:ids[2],content,takeaway}});assert.equal(r.status,200);
 const saved=stored(ids[1],ids[2]);assert.equal(saved.content,content);assert.equal(saved.takeaway,takeaway);assert.equal(saved.revision,1);
 const updated=await api('/api/feedback',{method:'PUT',body:{presenter:ids[1],reviewer:ids[2],content:'[AUTOMATED-VERIFY] 新版建議',takeaway:'[AUTOMATED-VERIFY] 新版心得'}});assert.equal(updated.status,200);
 const latest=stored(ids[1],ids[2]);assert.equal(latest.content,'[AUTOMATED-VERIFY] 新版建議');assert.equal(latest.takeaway,'[AUTOMATED-VERIFY] 新版心得');assert.equal(latest.revision,2);
});
test('只填心得、不填建議也可以儲存',async()=>{
 const r=await api('/api/feedback',{method:'PUT',body:{presenter:ids[1],reviewer:ids[0],content:'',takeaway:'[AUTOMATED-VERIFY] 只有心得'}});assert.equal(r.status,200);
 const saved=stored(ids[1],ids[0]);assert.equal(saved.content,'');assert.equal(saved.takeaway,'[AUTOMATED-VERIFY] 只有心得');
});
test('建議與心得各限 3,000 字，空白與超限拒絕',async()=>{
 const base={presenter:ids[0],reviewer:ids[2]};
 const ok=await api('/api/feedback',{method:'PUT',body:{...base,content:'x'.repeat(3000),takeaway:'y'.repeat(3000)}});assert.equal(ok.status,200);
 for(const body of [{...base,content:'x'.repeat(3001),takeaway:''},{...base,content:'',takeaway:'y'.repeat(3001)},{...base,content:'  ',takeaway:'  '}]){
  const r=await api('/api/feedback',{method:'PUT',body});assert.equal(r.status,400);
 }
});
test('查看給我的建議只回傳建議文字，不包含填寫者資訊',async()=>{
 const r=await api(`/api/presenter-feedback?presenter=${ids[0]}`);assert.equal(r.status,200);const data=await r.json();
 assert.deepEqual(Object.keys(data).sort(),['count','suggestions']);assert.equal(data.count,data.suggestions.length);assert.ok(data.suggestions.every(item=>typeof item==='string'));
 assert.equal(JSON.stringify(data).includes(ids[1]),false);
});
test('填寫進度只列出已完成項目，且依報告者學號排序',async()=>{
 const r=await api(`/api/student-progress?reviewer=${ids[2]}`);assert.equal(r.status,200);const data=await r.json();
 assert.ok(Array.isArray(data.items));
 const item=data.items.find(entry=>entry.presenterId===ids[1]);assert.ok(item);assert.equal(item.hasSuggestion,1);assert.equal(item.hasTakeaway,1);
 assert.deepEqual(Object.keys(item).sort(),['hasSuggestion','hasTakeaway','presenterId','presenterName']);
 const idsInOrder=data.items.map(entry=>entry.presenterId);assert.deepEqual(idsInOrder,[...idsInOrder].sort());
});
test('教師管理未登入不能讀取建議與心得',async()=>{
 const r=await api(`/api/teacher/feedback?presenter=${ids[0]}`);assert.equal(r.status,401);assert.equal((await r.json()).code,'TEACHER_AUTH');
});
const teacherPassword=process.env.SEMINAR_TEST_TEACHER_PASSWORD;
test('教師帳密登入、讀取排序後的建議與心得、登出',{skip:!teacherPassword},async()=>{
 const wrong=await api('/api/teacher/session',{method:'POST',body:{username:process.env.SEMINAR_TEST_TEACHER_USERNAME||'teacher',password:'wrong-password'}});
 assert.equal(wrong.status,401);assert.equal((await wrong.json()).code,'TEACHER_LOGIN');
 const login=await api('/api/teacher/session',{method:'POST',body:{username:process.env.SEMINAR_TEST_TEACHER_USERNAME||'teacher',password:teacherPassword}});
 assert.equal(login.status,200);const {token}=await login.json();
 const r=await api(`/api/teacher/feedback?presenter=${ids[0]}`,{headers:{'X-Teacher-Token':`Bearer ${token}`}});assert.equal(r.status,200);
 const data=await r.json();assert.ok(data.feedback.length>=1);const reviewerIds=data.feedback.map(item=>item.reviewerId);
 assert.deepEqual(reviewerIds,[...reviewerIds].sort());assert.ok(data.feedback.every(item=>Object.hasOwn(item,'content')&&Object.hasOwn(item,'takeaway')&&item.reviewerName));
 const del=await api(`/api/teacher/feedback?presenter=${ids[0]}&reviewer=${ids[1]}`,{method:'DELETE',headers:{'X-Teacher-Token':`Bearer ${token}`}});assert.equal(del.status,200);assert.equal((await del.json()).deleted,1);
 const after=await api(`/api/teacher/feedback?presenter=${ids[0]}`,{headers:{'X-Teacher-Token':`Bearer ${token}`}});assert.equal(after.status,200);assert.equal((await after.json()).feedback.some(item=>item.reviewerId===ids[1]),false);
 const logout=await api('/api/teacher/session',{method:'DELETE',headers:{'X-Teacher-Token':`Bearer ${token}`}});assert.equal(logout.status,200);
});
test('直接猜 PDF 路徑或私有目錄無法繞過通關',async()=>{
 for(const path of ['/'+'a'.repeat(64)+'.pdf','/.private/manifest.json','/.dev.vars','/worker/index.js']){const r=await api(path,{auth:false});assert.equal(r.status,404);}
});
test('登出後原工作階段立即失效',async()=>{
 const r=await api('/api/session',{method:'DELETE'});assert.equal(r.status,200);assert.equal((await api('/api/catalog')).status,401);
});
