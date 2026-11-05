// Record an explicitly experimental package after isolated acceptance.
// This does not run, change, or satisfy the strict pack:core release gate.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {x} from 'tar'
const project=path.resolve(import.meta.dirname,'..'),core=path.join(project,'packages/workbench-core')
const root=path.join(os.tmpdir(),'dsh-bay-172-isolated'),out=path.join(project,'releases/alpha17.2-private')
const artifacts=JSON.parse(await fs.readFile(path.join(root,'current-artifacts.json'),'utf8'))
const bytes=await fs.readFile(artifacts.core),sha=(value,kind='sha256')=>createHash(kind).update(value).digest('hex')
assert.equal(sha(bytes),artifacts.coreHash)
const extraction=await fs.mkdtemp(path.join(root,'verify-archive-'))
await x({file:artifacts.core,cwd:extraction,strict:true})
const archived=path.join(extraction,'package')
const manifest=JSON.parse(await fs.readFile(path.join(archived,'package.json'),'utf8'))
const inputs=JSON.parse(await fs.readFile(path.join(archived,'lib/build-inputs.json'),'utf8'))
assert.equal(manifest.version,'0.2.2-alpha.17.2');assert.equal(inputs.workbenchVersion,manifest.version)
const runtimeChecks=[]
for(const name of ['lib/index.js','lib/client.js','lib/build-inputs.json','package.json','THIRD_PARTY_NOTICES.txt']){
  const actual=await fs.readFile(path.join(archived,name)),expected=await fs.readFile(path.join(core,name))
  // pnpm normalizes package.json key order/whitespace when packing.
  if(name==='package.json')assert.deepEqual(JSON.parse(actual),JSON.parse(expected))
  else assert.deepEqual(actual,expected)
  runtimeChecks.push({path:name,sha256:sha(actual)})
}
const template='presets/workbench-creator/skills/workbench-extension-development'
for(const name of ['SKILL.md','WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md','templates/workbench-editor/README.md','templates/workbench-editor/package.json','templates/workbench-editor/client.js','templates/workbench-editor/index.js','templates/workbench-editor/cordis.patch.yml','templates/workbench-editor/LICENSE'])assert.deepEqual(await fs.readFile(path.join(archived,template,name)),await fs.readFile(path.join(core,template,name)))
const example=JSON.parse(await fs.readFile(path.join(archived,template,'templates/workbench-editor/package.json'),'utf8'))
assert.equal(example.dsh.workbench.coreCompatibility,manifest.version)
for(const input of [...inputs.inputs,...inputs.hostInputs])assert.equal(sha(await fs.readFile(path.resolve(core,input.path))),input.sha256,input.path)
const evidence=JSON.parse(await fs.readFile(path.join(root,'receiver-evidence.json'),'utf8'))
for(const profile of ['sender','receiver-verified']){
  const installed=path.join(root,profile,'profiles/web/node_modules/@dsh-workbench/core')
  for(const name of ['lib/index.js','lib/client.js'])assert.deepEqual(await fs.readFile(path.join(installed,name)),await fs.readFile(path.join(archived,name)))
  const profileManifest=JSON.parse(await fs.readFile(path.join(root,profile,'profiles/web/package.json'),'utf8'))
  assert(profileManifest.dependencies['@dsh-workbench/core'].endsWith(path.basename(artifacts.core)))
}
const install=JSON.parse(await fs.readFile(path.join(root,'receiver-install-evidence.json'),'utf8'))
assert.equal(evidence.coreHash,artifacts.coreHash);assert.equal(install.coreHash,artifacts.coreHash)
assert.equal(install.result.state,'restart-required');assert.equal(install.result.installed.length,2)
const logs={tests:'tests.log',typecheck:'typecheck.log',build:'build.log',identity:'identity.log',pack:'pack.log',export:'sender-export.log',import:'receiver-import.log',resume:'receiver-resume.log',restart:'receiver-restart.log',online:'online.log','sender-install':'sender-install.log','receiver-install':'receiver-install.log'}
const logPath=async name=>{const file='.tmp-alpha172-final-'+name+'.txt',live=path.join(project,file);return await fs.access(live).then(()=>live,()=>path.join(project,'.tmp-alpha172-runs',file))}
const readLog=async(name)=>{const b=await fs.readFile(await logPath(name));return b[0]===255&&b[1]===254?b.toString('utf16le'):b.toString('utf8')}
assert.match(await readLog('tests'),/107 passed/);assert.match(await readLog('tests'),/642 passed/)
const typecheck=await readLog('typecheck'),errors=typecheck.split(String.fromCharCode(10)).filter(l=>l.includes('error TS'))
assert.equal(errors.length,112);assert(errors.every(l=>l.includes('workbench-sidebar/generated/upstream/')))
assert.match(await readLog('restart'),/Restart persistence and private Host function passed/)
await fs.mkdir(out,{recursive:true})
const filename=path.basename(artifacts.core);await fs.copyFile(artifacts.core,path.join(out,filename))
for(const [from,to] of Object.entries(logs))await fs.copyFile(await logPath(from),path.join(out,to))
for(const name of ['receiver-evidence.json','receiver-install-evidence.json','online-evidence.json','sender-current-export.png','receiver-current-import.png','receiver-restored.png','receiver-network.jsonl'])await fs.copyFile(path.join(root,name),path.join(out,name))
await fs.copyFile(path.join(root,'private-workbench-current.wbpkg'),path.join(out,'acceptance-private-workbench.wbpkg'))
await fs.writeFile(path.join(out,'SHA256SUMS.txt'),artifacts.coreHash+'  '+filename+String.fromCharCode(10))
const archiveStat=await fs.stat(artifacts.core)
const candidate={status:'private-staging / experimental; release-gate-held',candidateId:inputs.candidateId,version:manifest.version,dshGeneration:inputs.dshGeneration,recordedAt:new Date().toISOString(),artifact:{path:filename,bytes:bytes.length,archiveModifiedAt:archiveStat.mtime.toISOString(),sha256:artifacts.coreHash,sha512:sha(bytes,'sha512'),integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')},checks:{archiveExtracted:true,manifestVersionMatched:true,hostAndClientBytesMatched:true,creatorTemplateMatched:true,clientInputs:inputs.inputs.length,hostInputs:inputs.hostInputs.length,allInputHashesMatched:true,runtimeChecks},validation:{source:{testFiles:107,tests:642,result:'passed',clientTests:'included in full suite',rc1Identity:'passed'},build:'passed',typecheck:{result:'failed',existingRc5SidebarWorkspaceErrors:112,newErrors:0},strictPackCore:'held; not bypassed or changed',isolatedDsh:{result:'passed',profile:'receiver-verified',coreSha256:artifacts.coreHash,initialReceiver:'DSH/Core only; no private packages or private store',extensions:['client-only','client-host'],retainedTabs:3,areas:2,splitRatio:0.6,restartResume:true,configurationRestored:true,hostEndpointAnswer:42,secondRestartPassed:true,importDidNotAutoOpen:true},network:'Unreachable registry; independent empty pnpm store; Node non-loopback connect/DNS rejected in Host and pnpm; browser external HTTP blocked. No OS-wide or physical network isolation.',online:'Real local HTTPS registry passed: recipient credentials, locked download, changed integrity, cross-origin rejection. No external private registry acceptance.',remaining:['existing RC1 declaration migration','broader official inner-page and real desktop application smoke','external private registry deployment acceptance','physical or OS-wide offline test if required for release']},notes:['Experimental private trial only; do not describe as stable release.','Signature is publisher/content identity, not author certification or code sandbox.','Cannot roll back external effects of executed extension code.','Different-version/content plugins are not automatically replaced.']}
await fs.writeFile(path.join(out,'candidate.json'),JSON.stringify(candidate,null,2)+String.fromCharCode(10))
console.log(JSON.stringify({output:out,artifact:filename,sha256:artifacts.coreHash,checks:candidate.checks,validation:candidate.validation},null,2))
