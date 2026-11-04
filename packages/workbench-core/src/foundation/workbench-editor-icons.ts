/** Safe, portable SVG geometry. The host owns all SVG elements and styling. */
export interface WorkbenchEditorSvgIconV1 {
  readonly version: 1
  readonly paths: readonly string[]
}
const arities: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
function validPath(path: string): boolean {
  if (path.length > 1024 || !/^[Mm]/.test(path) || /[^MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]/.test(path)) return false
  const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)/g) ?? []
  let index = 0
  while (index < tokens.length) {
    const command = tokens[index++]!.toUpperCase(), count = arities[command]
    if (count === undefined) return false
    const values: number[] = []
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index]!)) values.push(Number(tokens[index++]))
    if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 256)) return false
    if (count === 0 ? values.length !== 0 : values.length === 0 || values.length % count !== 0) return false
    if (command === 'A') for (let i = 0; i < values.length; i += 7) {
      if (values[i]! < 0 || values[i + 1]! < 0 || ![0, 1].includes(values[i + 3]!) || ![0, 1].includes(values[i + 4]!)) return false
    }
  }
  return tokens.length > 0 && /[LlHhVvCcSsQqTtAa]/.test(path)
}
export function normalizeWorkbenchEditorSvgIcon(value: unknown): WorkbenchEditorSvgIconV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.version !== 1 || Object.keys(row).some(key => key !== 'version' && key !== 'paths')
    || !Array.isArray(row.paths) || row.paths.length < 1 || row.paths.length > 12) return undefined
  if (!row.paths.every(path => typeof path === 'string' && validPath(path)) || row.paths.join('').length > 4096) return undefined
  return { version: 1, paths: [...row.paths] }
}

/** Legacy extensions retain a stable visual identity until their author supplies a semantic icon. */
export function fallbackWorkbenchEditorSvgIcon(identity: string): WorkbenchEditorSvgIconV1 {
  let hash = 2166136261
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const paths = ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z']
  let cells = ''
  // Sixteen small squares remain distinguishable at 20–24px without external assets.
  for (let i = 0; i < 16; i++) if ((hash >>> i) & 1 || i === 0) {
    const x = 6 + i % 4 * 3.3, y = 6 + Math.floor(i / 4) * 3.3
    cells += 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h1.4v1.4h-1.4Z'
  }
  paths.push(cells)
  return { version: 1, paths }
}
