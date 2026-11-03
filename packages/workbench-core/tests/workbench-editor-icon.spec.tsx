import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkbenchEditorIcon } from '../src/foundation/WorkbenchEditorIcon.tsx'
import { WORKBENCH_EDITOR_ICON_NAMES } from '../src/foundation/catalog.ts'

describe('Workbench editor icon set', () => {
  it('renders every semantic glyph as an accessible-size theme-inheriting outline SVG', () => {
    for (const name of WORKBENCH_EDITOR_ICON_NAMES) {
      const markup = renderToStaticMarkup(createElement(WorkbenchEditorIcon, { name }))
      expect(markup).toContain('viewBox="0 0 24 24"')
      expect(markup).toContain('fill="none"')
      expect(markup).toContain('stroke="currentColor"')
      expect(markup).toContain('aria-hidden="true"')
      expect(markup).toContain('<path')
    }
  })

  it('falls back to the neutral extension glyph for an unsupported token', () => {
    const invalid = renderToStaticMarkup(createElement(WorkbenchEditorIcon, { name: 'unknown' }))
    const extension = renderToStaticMarkup(createElement(WorkbenchEditorIcon, { name: 'extension' }))
    expect(invalid).toBe(extension)
  })
})
