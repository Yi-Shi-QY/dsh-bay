// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchContextDialog } from '../src/foundation/WorkbenchContextDialog.tsx'

afterEach(() => cleanup())

it('passes the Area scope to AI background generation', async () => {
  const generateDraft = vi.fn(async () => '# Area draft')
  const view = render(<WorkbenchContextDialog
    directory={{ updateAreaBackground: vi.fn(async () => ({ status: 'committed' as const, revision: 2 })) } as never}
    workbenchId="wb"
    areaId="area-a"
    title="编辑区域背景"
    initialValue="existing objective"
    generateDraft={generateDraft}
    onClose={vi.fn()}
  />)
  fireEvent.click(view.getByRole('button', { name: 'AI 辅助生成草稿' }))
  await waitFor(() => expect(generateDraft).toHaveBeenCalledWith({ workbenchId: 'wb', scope: 'area', areaId: 'area-a', currentValue: 'existing objective' }))
})
