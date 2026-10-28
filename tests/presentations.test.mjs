import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {validatePresentation,MAX_PRESENTATION_BYTES} from '../worker/presentations.js';
import {validatePaper,MAX_PAPER_BYTES} from '../worker/papers.js';
import worker from '../worker/index.js';

const student = {id:'99990001',name:'測試同學'};
const pdf = Buffer.from('%PDF-1.4\nTest presentation\n%%EOF');
const payload = (bytes=pdf,filename='report.pdf')=>({studentId:student.id,filename,data:bytes.toString('base64'),uploadId:randomUUID()});
const paperPayload = (bytes=pdf,filename='2024_測試文章.pdf')=>({studentId:student.id,filename,data:bytes.toString('base64'),uploadId:randomUUID()});
const source = readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
function fixture() {
  let sequence=0,createdFolders=0;
  const folders=[],allFiles=new Map(),cache=new Map();
  const iter=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
  const makeBlob=(data,type,name)=>({getBytes:()=>[...data].map(b=>b>127?b-256:b),getName:()=>name,getContentType:()=>type,copyBlob(){return makeBlob(data,type,name);},setContentType(){return this;}});
  const addFile=(folder,name,bytes,mime,description='')=>{
    const file={id:`fakeDriveFile_${++sequence}`,name,description,trashed:false,getId(){return this.id;},getName(){return this.name;},setName(n){this.name=n;return this;},getSize:()=>bytes.length,getMimeType:()=>mime,getDescription(){return this.description;},setDescription(d){this.description=d;return this;},setContent(blob){bytes=Buffer.from(blob.getBytes().map(b=>(b+256)%256));mime=blob.getContentType();return this;},getLastUpdated:()=>new Date(),isTrashed(){return this.trashed;},setTrashed(t){this.trashed=t;},getBlob:()=>makeBlob(bytes,mime,name),getParents:()=>iter([folder])};
    folder.files.push(file);allFiles.set(file.id,file);return file;
  };
  const addFolder=name=>{
    const folder={files:[],getId:()=>`folder_${++sequence}`,getName:()=>name,getParents:()=>iter([root]),getFiles(){return iter(this.files.filter(f=>!f.trashed));},createFile(blob){return addFile(this,blob.getName(),Buffer.from(blob.getBytes().map(b=>(b+256)%256)),blob.getContentType());}};
    folders.push(folder);return folder;
  };
  const root={getId:()=> 'root',getFolders:()=>iter(folders),createFolder(name){createdFolders++;return addFolder(name);}};
  const bytes=x=>typeof x==='string'?Buffer.from(x):Buffer.from(x.map(b=>(b+256)%256));
  const context=vm.createContext({console,Date,Set,JSON,Number,String,Object,Error,
    MimeType:{PDF:'application/pdf'},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,v)=>[...createHash('sha256').update(bytes(v)).digest()],computeHmacSha256Signature:(v,s)=>[...createHmac('sha256',s).update(v).digest()],base64Decode:s=>[...Buffer.from(s,'base64')],base64Encode:x=>bytes(x).toString('base64'),newBlob:(b,t,n)=>makeBlob(bytes(b),t,n),unzip:()=>[{getName:()=> 'ppt/presentation.xml'},{getName:()=> '[Content_Types].xml'}]},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},
    DriveApp:{getFileById:id=>allFiles.get(id)},
  });
  vm.runInContext(source,context);
  return {context,root,folders,addFolder,addFile,get createdFolders(){return createdFolders;}};
}

test('統一以選取學號命名，接受三種格式與大小寫副檔名',()=>{
  for(const [extension,bytes] of [['pdf',pdf],['pptx',Buffer.from('504b030478797a','hex')],['ppt',Buffer.from('d0cf11e0a1b11ae1','hex')]]) {
    const result=validatePresentation(payload(bytes,`任意名稱.${extension.toUpperCase()}`));
    assert.equal(result.filename,`${student.id}.${extension}`);
  }
});
test('5 MB 邊界可上傳；多 1 byte、空檔、假副檔名、未知格式拒絕',()=>{
  const boundary=Buffer.alloc(MAX_PRESENTATION_BYTES,32);pdf.copy(boundary);
  assert.equal(validatePresentation(payload(boundary)).byteSize,MAX_PRESENTATION_BYTES);
  assert.throws(()=>validatePresentation(payload(Buffer.concat([boundary,Buffer.from('x')]))),/5MB/);
  assert.throws(()=>validatePresentation(payload(Buffer.alloc(0))),/不可為空/);
  for(const p of [payload(Buffer.from('not pdf')),payload(pdf,'file.exe'),{...payload(),studentId:'invalid'}])assert.throws(()=>validatePresentation(p));
});
test('雲端缺資料夾即建「學號 姓名」，重試不產生重複檔',()=>{
  const f=fixture(),p=validatePresentation(payload());
  const first=f.context.uploadPresentation_(f.root,[student],p);
  const second=f.context.uploadPresentation_(f.root,[student],p);
  assert.equal(f.createdFolders,1);assert.equal(f.folders[0].getName(),`${student.id} ${student.name}`);
  assert.equal(first.presentation.driveFileId,second.presentation.driveFileId);assert.equal(f.folders[0].files.length,1);
});
test('沿用既有學生資料夾、保留文章；重新上傳簡報會覆蓋並只留一份',()=>{
  const f=fixture(),folder=f.addFolder(`${student.id} ${student.name}`);
  f.addFile(folder,'article.pdf',pdf,'application/pdf');
  const oldPpt=f.addFile(folder,`${student.id}.ppt`,Buffer.from('d0cf11e0a1b11ae1','hex'),'application/vnd.ms-powerpoint');
  f.context.uploadPresentation_(f.root,[student],validatePresentation(payload()));
  f.context.uploadPresentation_(f.root,[student],validatePresentation(payload()));
  const catalog=f.context.catalog_(f.root,[student]);
  assert.equal(f.createdFolders,0);assert.equal(catalog.papers.length,1);assert.equal(catalog.presentations.length,1);
  assert.equal(folder.files.filter(file=>!file.trashed).length,2);assert.equal(oldPpt.trashed,true);
  assert.equal(catalog.presentations[0].filename,`${student.id}.pdf`);
});
test('重新上傳不同格式簡報會汰換舊檔，不留下兩份',()=>{
  const f=fixture(),folder=f.addFolder(`${student.id} ${student.name}`);
  f.addFile(folder,`${student.id}.ppt`,Buffer.from('d0cf11e0a1b11ae1','hex'),'application/vnd.ms-powerpoint');
  f.context.uploadPresentation_(f.root,[student],validatePresentation(payload()));
  f.context.uploadPresentation_(f.root,[student],validatePresentation(payload(Buffer.from('504b030478797a','hex'),'update.pptx')));
  const catalog=f.context.catalog_(f.root,[student]);
  assert.equal(catalog.presentations.length,1);assert.equal(folder.files.filter(file=>!file.trashed).length,1);
  assert.equal(catalog.presentations[0].filename,`${student.id}.pptx`);
});
test('Google 端獨立拒絕超限、冒用學生與重複身分資料夾',()=>{
  const f=fixture(),p=validatePresentation(payload());
  assert.throws(()=>f.context.uploadPresentation_(f.root,[],p));
  assert.throws(()=>f.context.uploadPresentation_(f.root,[student],{...p,byteSize:5242881,data:Buffer.alloc(5242881).toString('base64')}));
  f.addFolder(`${student.id} ${student.name}`);f.addFolder(`${student.id} ${student.name}`);
  assert.throws(()=>f.context.uploadPresentation_(f.root,[student],p));
});
test('簽章綁定上傳內容、拒絕遭竄改 payload 與重播 nonce',()=>{
  const f=fixture(),p=validatePresentation(payload()),timestamp=Date.now(),nonce='a'.repeat(32),secret='unit-test-only';
  const hash=createHash('sha256').update(JSON.stringify(p)).digest('hex');
  const signature=createHmac('sha256',secret).update([timestamp,'upload','',nonce,hash].join(':')).digest('hex');
  const r={op:'upload',fileId:'',timestamp,nonce,payload:p,signature};
  assert.equal(f.context.verifyRequest_({...r,payload:{...p,studentId:'99990002'}},secret),false);
  assert.equal(f.context.verifyRequest_(r,secret),true);assert.equal(f.context.verifyRequest_(r,secret),false);
});
test('未通關不能上傳或下載簡報',async()=>{
  for(const [path,method]of [['/api/presentations','POST'],['/api/presentations/'+'a'.repeat(24),'GET']]) {
    const r=await worker.fetch(new Request('https://example.test'+path,{method}),{},{waitUntil(){}});assert.equal(r.status,401);
  }
});
test('文章以「年份_篇名」命名，接受大小寫副檔名並拒絕不合格名稱',()=>{
  const result=validatePaper(paperPayload(pdf,'2024_綠色行銷對品牌權益的影響.PDF'));
  assert.equal(result.filename,'2024_綠色行銷對品牌權益的影響.pdf');
  assert.equal(result.mimeType,'application/pdf');
  for(const filename of ['綠色行銷.pdf','24_綠色行銷.pdf','2024-.pdf','2024_ .pdf','2024_綠/色.pdf','2024_'+'x'.repeat(151)+'.pdf']){
    assert.throws(()=>validatePaper(paperPayload(pdf,filename)));
  }
  assert.throws(()=>validatePaper({...paperPayload(),studentId:'invalid'}));
});
test('文章 5 MB 邊界可上傳；多 1 byte、空檔、非 PDF 拒絕',()=>{
  const boundary=Buffer.alloc(MAX_PAPER_BYTES,32);pdf.copy(boundary);
  assert.equal(validatePaper(paperPayload(boundary)).byteSize,MAX_PAPER_BYTES);
  assert.throws(()=>validatePaper(paperPayload(Buffer.concat([boundary,Buffer.from('x')]))),/5MB/);
  assert.throws(()=>validatePaper(paperPayload(Buffer.alloc(0))),/不可為空/);
  assert.throws(()=>validatePaper(paperPayload(Buffer.from('not pdf'))),/PDF/);
});
test('雲端文章上傳建立資料夾、重試去重，並與簡報分流',()=>{
  const f=fixture(),p=validatePaper(paperPayload());
  const first=f.context.uploadPaper_(f.root,[student],p);
  const second=f.context.uploadPaper_(f.root,[student],p);
  assert.equal(f.createdFolders,1);assert.equal(f.folders[0].getName(),`${student.id} ${student.name}`);
  assert.equal(first.paper.driveFileId,second.paper.driveFileId);assert.equal(f.folders[0].files.length,1);
  assert.equal(first.paper.filename,'2024_測試文章.pdf');
  const catalog=f.context.catalog_(f.root,[student]);
  assert.equal(catalog.papers.length,1);assert.equal(catalog.papers[0].filename,'2024_測試文章.pdf');
  assert.equal(catalog.papers[0].title,'測試文章');assert.equal(catalog.presentations.length,0);
  f.context.uploadPresentation_(f.root,[student],validatePresentation(payload()));
  const mixed=f.context.catalog_(f.root,[student]);
  assert.equal(mixed.papers.length,1);assert.equal(mixed.presentations.length,1);
});
test('重新上傳文章會覆蓋舊文章，只保留最新一份',()=>{
  const f=fixture(),folder=f.addFolder(`${student.id} ${student.name}`);
  const old=f.addFile(folder,'2023_舊文章.pdf',pdf,'application/pdf');
  f.context.uploadPaper_(f.root,[student],validatePaper(paperPayload(pdf,'2024_新文章.pdf')));
  f.context.uploadPaper_(f.root,[student],validatePaper(paperPayload(pdf,'2025_更新文章.pdf')));
  const catalog=f.context.catalog_(f.root,[student]);
  assert.equal(catalog.papers.length,1);assert.equal(catalog.papers[0].filename,'2025_更新文章.pdf');
  assert.equal(folder.files.filter(file=>!file.trashed).length,1);assert.equal(folder.files.filter(file=>!file.trashed)[0].getName(),'2025_更新文章.pdf');
  assert.equal(old.trashed,true);
});
test('Google 端獨立拒絕文章超限、空白篇名、冒用學生與重複身分資料夾',()=>{
  const f=fixture(),p=validatePaper(paperPayload());
  assert.throws(()=>f.context.uploadPaper_(f.root,[],p));
  assert.throws(()=>f.context.uploadPaper_(f.root,[student],{...p,filename:'2024_ .pdf'}));
  assert.throws(()=>f.context.uploadPaper_(f.root,[student],{...p,byteSize:MAX_PAPER_BYTES+1,data:Buffer.alloc(MAX_PAPER_BYTES+1).toString('base64')}));
  f.addFolder(`${student.id} ${student.name}`);f.addFolder(`${student.id} ${student.name}`);
  assert.throws(()=>f.context.uploadPaper_(f.root,[student],p));
});
test('文章簽章綁定上傳內容，拒絕遭竄改 payload',()=>{
  const f=fixture(),p=validatePaper(paperPayload()),timestamp=Date.now(),nonce='b'.repeat(32),secret='unit-test-only';
  const hash=createHash('sha256').update(JSON.stringify(p)).digest('hex');
  const signature=createHmac('sha256',secret).update([timestamp,'upload-paper','',nonce,hash].join(':')).digest('hex');
  const r={op:'upload-paper',fileId:'',timestamp,nonce,payload:p,signature};
  assert.equal(f.context.verifyRequest_({...r,payload:{...p,filename:'2024_遭竄改.pdf'}},secret),false);
  assert.equal(f.context.verifyRequest_(r,secret),true);assert.equal(f.context.verifyRequest_(r,secret),false);
});
test('未通關不能上傳文章',async()=>{
  const r=await worker.fetch(new Request('https://example.test/api/papers',{method:'POST'}),{},{waitUntil(){}});assert.equal(r.status,401);
});
