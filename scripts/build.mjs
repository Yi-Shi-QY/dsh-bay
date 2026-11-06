import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { WORKBENCH_PACKAGE_NAME, WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION, WORKBENCH_UPSTREAM_COMMIT } from '../packages/workbench-core/src/release-compatibility.ts'

const project = fileURLToPath(new URL('../', import.meta.url))
const core = path.join(project, 'packages', 'workbench-core')
const manifestPath = path.join(core, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const buildId = process.env.DSH_BAY_BUILD_ID ?? `dsh-bay-${WORKBENCH_CORE_VERSION}-dsh-${WORKBENCH_DSH_GENERATION}`

if (manifest.name !== WORKBENCH_PACKAGE_NAME) throw new Error('DSH Bay package name mismatch')
if (manifest.version !== WORKBENCH_CORE_VERSION) throw new Error('DSH Bay Core version mismatch')
if (manifest.dsh.workbench.dshGeneration !== WORKBENCH_DSH_GENERATION) throw new Error('DSH generation mismatch')
if (manifest.dsh.workbench.upstreamCommit !== WORKBENCH_UPSTREAM_COMMIT) throw new Error('DSH upstream commit mismatch')

mkdirSync(path.join(core, 'lib'), { recursive: true })

const hostResult = await build({
  absWorkingDir: core,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: { js: 'import { createRequire as __dshCreateRequire } from "node:module"; const require = __dshCreateRequire(import.meta.url);' },
  target: 'node24',
  external: ['@deepseek-ai/*'],
  sourcemap: false,
  metafile: true,
})

const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  ...Object.keys(manifest.peerDependencies).filter(name =>
    name.startsWith('@deepseek-ai/dsh-client-')
    || name.startsWith('@deepseek-ai/dsh-api-')
    || name.startsWith('@dsh-workbench/')),
]

const result = await build({
  absWorkingDir: core,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  jsx: 'automatic',
  format: 'cjs',
  target: 'es2022',
  external,
  write: false,
  metafile: true,
  define: {
    '__WORKBENCH_BUILD_ID__': JSON.stringify(buildId),
    'process.env.NODE_ENV': '"production"',
    'process.env.DSH_CLIENT_COMMIT_HASH': JSON.stringify(WORKBENCH_UPSTREAM_COMMIT),
    '__WORKBENCH_XTERM_CSS__': JSON.stringify(readFileSync(path.join(project, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8')),
  },
  loader: { '.css': 'local-css', '.svg': 'dataurl' },
  plugins: [{
    name: 'dsh-xterm-global-css',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /[\\/]@xterm[\\/]xterm[\\/]css[\\/]xterm\.css$/ }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'css' }))
    },
  }],
})

const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
if (js === undefined) throw new Error('Client bundle did not produce JavaScript')
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const imports = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path)))].sort()
if (imports.includes('@deepseek-ai/dsh-api-workspace-controller/default-workspace')) {
  throw new Error('RC1 default-workspace helper must be bundled locally; it has no client module-table row')
}
manifest.dsh.client.external = imports.filter(name => !['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/cordis'].includes(name))
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(path.join(core, 'lib/client.js'), `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;\nconst style = document.createElement("style"); style.dataset.plugin = ${JSON.stringify(manifest.name)}; style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style);\n${js}\nreturn module.exports;}});\n`)

const inputs = [...new Set(Object.keys(result.metafile.inputs))].sort().map(file => ({
  path: file.replaceAll(String.fromCharCode(92), '/'),
  sha256: createHash('sha256').update(readFileSync(path.resolve(core, file))).digest('hex'),
}))
writeFileSync(path.join(core, 'lib/build-inputs.json'), JSON.stringify({
  candidateId: buildId,
  packageName: WORKBENCH_PACKAGE_NAME,
  productLine: `DSH Bay ${WORKBENCH_CORE_VERSION}`,
  mode: 'core-only',
  buildId,
  dshGeneration: WORKBENCH_DSH_GENERATION,
  upstreamCommit: WORKBENCH_UPSTREAM_COMMIT,
  sourceDigest: manifest.dsh.workbench.sourceDigest,
  workbenchVersion: manifest.version,
  defaultInstall: [WORKBENCH_PACKAGE_NAME],
  excludedModules: ['@dsh-workbench/conversation-suite', '@dsh-workbench/svgdeepseek-pet'],
  more: { workbench: 'deferred', official: 'rc1-ui-entry-customization-only' },
  inputs,
  hostInputs: Object.keys(hostResult.metafile.inputs).sort().map(file => ({
    path: file.replaceAll(String.fromCharCode(92), '/'),
    sha256: createHash('sha256').update(readFileSync(path.resolve(core, file))).digest('hex'),
  })),
  external: imports,
  creator: { mode: 'native-dsh-skill-provider', presetOverride: false },
}, null, 2) + '\n')

console.log(`Built DSH Bay ${manifest.name}@${manifest.version} against DSH ${WORKBENCH_DSH_GENERATION}`)
