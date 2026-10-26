import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
const site='https://fricachai.github.io/seminar-feedback-1151/';
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sha=value=>createHash('sha256').update(value).digest('hex');
const results=[];
for(const name of ['index.html','app.js','styles.css','config.js','favicon.svg']){
 const response=await fetch(site+name+'?v='+commit,{signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,`${name}: HTTP 200 required`);
 const actual=Buffer.from(await response.arrayBuffer());
 const expected=execFileSync('git',['show',`HEAD:public/${name}`]);
 assert.equal(sha(actual),sha(expected),`${name}: published file differs from committed source`);
 results.push({file:name,status:response.status,sha256:sha(actual),matchesCommit:true});
}
const report={site,commit,publishedFilesMatch:true,files:results,verifiedAt:new Date().toISOString()};
mkdirSync('output',{recursive:true});writeFileSync('output/published-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({site,commit,publishedFilesMatch:true,filesVerified:results.length}));
