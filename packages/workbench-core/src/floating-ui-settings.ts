export const FLOATING_UI_SETTINGS_ROUTE = '/api/workbench/ui-settings'
export const FLOATING_UI_SETTINGS_NAMESPACE = 'workbench.floating-ui.v1'
export interface FloatingUiGeometry { rect?: { x: number; y: number; width: number; height: number }; launcher?: { x: number; y: number } }
export function validFloatingGeometry(value: unknown): value is FloatingUiGeometry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !['rect', 'launcher'].includes(key))) return false
  return (['rect', 'launcher'] as const).every(key => {
    const v = row[key]; if (v === undefined) return true
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false
    const fields = v as Record<string, unknown>, names = key === 'rect' ? ['x', 'y', 'width', 'height'] : ['x', 'y']
    return Object.keys(fields).length === names.length && names.every(name => typeof fields[name] === 'number' && Number.isFinite(fields[name]) && (fields[name] as number) >= 0 && (fields[name] as number) <= 100000)
      && (key !== 'rect' || (fields.width as number) > 0 && (fields.height as number) > 0)
  })
}
