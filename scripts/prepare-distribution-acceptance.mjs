// Isolated acceptance fixtures only; never resolves the user's default Profile.
import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const root = path.join(os.tmpdir(), 'dsh-bay-172-isolated')
await fs.mkdir(root, { recursive: true })
const require = createRequire(import.meta.url)
await build({ entryPoints: ['packages/workbench-core/src/host-distribution-artifacts.ts'], outfile: path.join(root, 'artifacts-current.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['@deepseek-ai/*'] })
await build({ entryPoints: ['packages/workbench-core/src/workbench-extension-access.ts'], outfile: path.join(root, 'qa-contract.cjs'), bundle: true, platform: 'node', format: 'cjs' })
const { prepareDistributionArtifact } = require(path.join(root, 'artifacts-current.cjs'))
const core = await fs.readFile(path.join(root, 'dsh-workbench-core-0.2.2-alpha.17.2.tgz'))
const hash = createHash('sha256').update(core).digest('hex')
const coreFile = path.join(root, 'dsh-workbench-core-0.2.2-alpha.17.2-' + hash.slice(0, 12) + '.tgz')
await fs.writeFile(coreFile, core)
const artifacts = { core: coreFile, coreHash: hash }
for (const kind of ['client', 'host']) {
  const dir = path.join(root, 'fixture-' + kind)
  await fs.cp('packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor', dir, { recursive: true })
  const packageName = '@local/private-' + kind
  for (const file of ['package.json', 'client.js', 'cordis.patch.yml']) {
    let source = await fs.readFile(path.join(dir, file), 'utf8')
    source = source.replaceAll('@local/workbench-editor-example', packageName).replaceAll('workbench-editor-example', 'qa-private-' + kind).replaceAll('workbench.editor-example', 'qa.private.' + kind).replaceAll('workbench.example', 'qa.' + kind)
    await fs.writeFile(path.join(dir, file), source)
  }
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'))
  manifest.dsh.workbench.distribution.runtimeKind = kind === 'host' ? 'client-host' : 'client-only'
  if (kind === 'host') {
    await fs.writeFile(path.join(dir, 'index.js'), "export const name='@local/private-host'; export const inject=['connection']; export function apply(ctx) { const off=ctx.get('connection').fetch.register({path:'/api/qa-private-host',methods:['POST'],fetch:async()=>Response.json({answer:42,source:'private-host'})});ctx.effect(()=>off); }")
    let client = await fs.readFile(path.join(dir, 'client.js'), 'utf8')
    client = client.replace('onClick: () => owner.setState({ schemaVersion: 1, acknowledged: true })', "onClick: async () => { const r=await fetch('/api/qa-private-host',{method:'POST'}); const v=await r.json(); owner.setState({schemaVersion:1,acknowledged:v.answer===42}); }").replaceAll('记录本机状态', '验证私有 Host 功能')
    await fs.writeFile(path.join(dir, 'client.js'), client)
  }
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  const prepared = await prepareDistributionArtifact(dir, (name, version) => name === 'react' && version === '18.3.1' || name === '@deepseek-ai/dsh-client-ui-slots' && version === '0.2.1-rc.5')
  const file = path.join(root, 'private-' + kind + '-' + prepared.dependency.archiveSha256.slice(0, 12) + '.tgz')
  await fs.writeFile(file, prepared.bytes)
  artifacts[kind] = file
  artifacts[kind + 'Identity'] = prepared.dependency
}
await fs.writeFile(path.join(root, 'current-artifacts.json'), JSON.stringify(artifacts, null, 2))
console.log(JSON.stringify(artifacts, null, 2))
