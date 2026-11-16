import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolDirectory = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(toolDirectory, '../..')
const args = process.argv.slice(2)
const inputPaths = args.filter(argument => argument.startsWith('--input=')).map(argument => argument.slice('--input='.length))
const outputArgument = args.find(argument => argument.startsWith('--output='))
const unknown = args.filter(argument => !argument.startsWith('--input=') && !argument.startsWith('--output='))
if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`)
if (inputPaths.length === 0) inputPaths.push('tools/dsh-adaptation/reports')

const resolvePath = value => path.resolve(project, value)
const reportFiles = new Set()
for (const input of inputPaths) {
  const absolute = resolvePath(input)
  const stat = statSync(absolute)
  if (stat.isDirectory()) {
    for (const name of readdirSync(absolute)) if (name.toLowerCase().endsWith('.json')) reportFiles.add(path.join(absolute, name))
  } else reportFiles.add(absolute)
}

const reports = []
for (const filename of reportFiles) {
  const report = JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/u, ''))
  if (report.schemaVersion !== 1 || report.mode !== 'remote' || !report.github?.comparison || !report.summary) continue
  reports.push(report)
}
if (reports.length === 0) throw new Error('No remote DSH drift reports found in the input')
reports.sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt))

const lastInput = resolvePath(inputPaths.at(-1))
const defaultOutput = statSync(lastInput).isDirectory()
  ? path.join(lastInput, 'dsh-drift.html')
  : path.join(path.dirname(lastInput), `${path.basename(lastInput, path.extname(lastInput))}.html`)
const outputPath = resolvePath(outputArgument?.slice('--output='.length) ?? path.relative(project, defaultOutput))
const template = readFileSync(path.join(toolDirectory, 'report-template.html'), 'utf8')
const css = readFileSync(path.join(toolDirectory, 'report.css'), 'utf8')
const app = readFileSync(path.join(toolDirectory, 'report-app.js'), 'utf8')
const data = JSON.stringify(reports).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
const replacements = new Map([
  ['@@REPORT_CSS@@', css],
  ['@@REPORT_DATA@@', data],
  ['@@REPORT_APP@@', app],
])
let html = template
for (const [marker, content] of replacements) {
  if (html.split(marker).length !== 2) throw new Error(`Expected exactly one template marker: ${marker}`)
  html = html.replace(marker, content)
}
mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(outputPath, html)
console.log(JSON.stringify({
  status: 'passed',
  reportsEmbedded: reports.length,
  latestTag: reports.at(-1).github.latestTag,
  output: path.relative(project, outputPath).split(path.sep).join('/'),
}, null, 2))
