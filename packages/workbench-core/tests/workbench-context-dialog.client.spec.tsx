// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchContextDialog } from '../src/foundation/WorkbenchContextDialog.tsx'

afterEach(() => cleanup())

it.each(['area', 'workbench'] as const)('prefills the %s draft and writes only after explicit save', async scope => {
  const generateDraft = vi.fn(async () => '# Area draft')
  const updateAreaBackground = vi.fn(async () => ({ status: 'committed' as const, revision: 2 }))
  const updateWorkbenchBackground = vi.fn(async () => ({ status: 'committed' as const, revision: 2 }))
  const view = render(<WorkbenchContextDialog
    directory={{ updateAreaBackground, updateWorkbenchBackground } as never}
    workbenchId="wb"
    {...(scope === 'area' ? { areaId: 'area-a' } : {})}
    title="编辑区域背景"
    initialValue="existing objective"
    generateDraft={generateDraft}
    onClose={vi.fn()}
  />)
  fireEvent.click(view.getByRole('button', { name: 'AI 辅助生成草稿' }))
  await waitFor(() => expect(generateDraft).toHaveBeenCalledWith({ workbenchId: 'wb', scope, ...(scope === 'area' ? { areaId: 'area-a' } : {}), currentValue: 'existing objective' }))
  await waitFor(() => expect((view.getByLabelText('背景说明') as HTMLTextAreaElement).value).toBe('# Area draft'))
  expect(updateAreaBackground).not.toHaveBeenCalled()
  expect(updateWorkbenchBackground).not.toHaveBeenCalled()
  fireEvent.change(view.getByLabelText('背景说明'), { target: { value: 'reviewed draft' } })
  fireEvent.click(view.getByRole('button', { name: '保存背景' }))
  await waitFor(() => scope === 'area'
    ? expect(updateAreaBackground).toHaveBeenCalledWith('wb', 'area-a', 'reviewed draft')
    : expect(updateWorkbenchBackground).toHaveBeenCalledWith('wb', 'reviewed draft'))
})
