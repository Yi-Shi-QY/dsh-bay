import type { ReactNode } from 'react'
import type { WorkbenchPresetNode } from './workbench-layout-presets.ts'

/** Small geometry-only glyph; shared by the menu and creation confirmation. */
export function WorkbenchPresetIcon({ node }: { node: WorkbenchPresetNode }) {
  const draw = (part: WorkbenchPresetNode, x: number, y: number, width: number, height: number): ReactNode => {
    if (typeof part === 'number') return <rect key={part} x={x} y={y} width={width} height={height} rx={1.5} />
    const gap = 3
    if (part.axis === 'horizontal') {
      const first = (width - gap) * part.ratio
      return <>{draw(part.first, x, y, first, height)}{draw(part.second, x + first + gap, y, width - first - gap, height)}</>
    }
    const first = (height - gap) * part.ratio
    return <>{draw(part.first, x, y, width, first)}{draw(part.second, x, y + first + gap, width, height - first - gap)}</>
  }
  return <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">{draw(node, 1.5, 1.5, 29, 21)}</svg>
}
