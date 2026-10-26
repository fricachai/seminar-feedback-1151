import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const manifest=JSON.parse(readFileSync('.private/manifest.json','utf8'));
const bridge=JSON.parse(readFileSync('.private/bridge-settings.json','utf8'));
const code=readFileSync('.private/classroom-access.txt','utf8').match(/^code=(.+)$/m)[1];
const forbiddenValues=[code,bridge.BRIDGE_SECRET,...manifest.students.flatMap(s=>[s.id,s.name])].filter(Boolean);
const forbiddenPaths=/^(?:\.private(?:-assets)?\/|\.dev\.vars|\.wrangler\/|node_modules\/|output\/)|\.(?:pdf|xlsx|gsheet|gform|png|jpe?g|zip)$/i;
const problems=[];
for(const file of files){
 if(forbiddenPaths.test(file)){problems.push({file,reason:'private path or source binary'});continue;}
 const text=readFileSync(file,'utf8');
 if(forbiddenValues.some(value=>text.includes(value)))problems.push({file,reason:'private value'});
 if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))problems.push({file,reason:'credential pattern'});
}
const result={passed:problems.length===0,trackedFiles:files.length,privateValuesChecked:forbiddenValues.length,findings:problems.length,verifiedAt:new Date().toISOString()};
writeFileSync('.private/release-audit.json',JSON.stringify({...result,problems},null,2));
console.log(JSON.stringify(result));
if(!result.passed)process.exitCode=1;
