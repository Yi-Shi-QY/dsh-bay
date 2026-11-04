// Real HTTPS transport test against a disposable local registry; no external service.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import https from 'node:https'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const root=path.join(os.tmpdir(),'dsh-bay-172-isolated','https-registry')
await fs.mkdir(root,{recursive:true})
const cert=path.join(root,'localhost.crt'),key=path.join(root,'localhost.key')
if(!process.env.DSH_QA_HTTPS_WORKER){
  execFileSync(process.env.DSH_QA_OPENSSL??'C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',windowsHide:true})
  execFileSync(process.execPath,[fileURLToPath(import.meta.url)],{stdio:'inherit',windowsHide:true,env:{...process.env,DSH_QA_HTTPS_WORKER:'1',NODE_EXTRA_CA_CERTS:cert}})
}else{
  await build({entryPoints:['packages/workbench-core/src/host-distribution-route.ts'],outfile:path.join(root,'route.cjs'),bundle:true,platform:'node',format:'cjs',external:['@deepseek-ai/*']})
  // Resolve native public APIs from this checkout; no copied dependencies.
  const require=createRequire(import.meta.url)
  const Module=require('node:module');process.env.NODE_PATH=path.resolve('node_modules');Module._initPaths()
  const {fetchLockedDistributionArtifact}=require(path.join(root,'route.cjs'))
  const artifacts=JSON.parse(await fs.readFile(path.join(root,'../current-artifacts.json'),'utf8'))
  const bytes=await fs.readFile(artifacts.client),dependency=artifacts.clientIdentity
  let changed=false,cross=false,requests=0
  const server=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
    requests++
    if(req.headers.authorization!=='Bearer isolated-recipient-token'){res.writeHead(401);res.end();return}
    if(req.url==='/team/private.tgz'){res.end(bytes);return}
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({name:dependency.packageName,version:dependency.version,dist:{integrity:changed?'sha512-changed':dependency.integrity,tarball:cross?'https://example.invalid/private.tgz':base+'private.tgz'}}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base='https://127.0.0.1:'+server.address().port+'/team/'
  const d={...dependency,registryUrl:base}
  try{
    await assert.rejects(fetchLockedDistributionArtifact(d,root),/凭据/)
    const origin=new URL(base)
    await fs.writeFile(path.join(root,'.npmrc'),'//'+origin.host+'/team/:_authToken=isolated-recipient-token')
    assert.deepEqual(await fetchLockedDistributionArtifact(d,root),new Uint8Array(bytes))
    changed=true;await assert.rejects(fetchLockedDistributionArtifact(d,root),/完整性/)
    changed=false;cross=true;await assert.rejects(fetchLockedDistributionArtifact(d,root),/跨站/)
    const result={status:'passed',transport:'real local HTTPS with verified temporary CA',requests,cases:['missing recipient credential rejected','locked artifact downloaded with recipient token','changed lock rejected','cross-origin tarball rejected'],externalPrivateRegistryTested:false,time:new Date().toISOString()}
    await fs.writeFile(path.join(root,'../online-evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(path.join(root,'.npmrc'),{force:true});await fs.rm(key,{force:true})}
}
