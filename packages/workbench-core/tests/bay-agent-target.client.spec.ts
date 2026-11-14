import { expect, it } from 'vitest'
import { bayAgentWorkbenchTarget } from '../src/client/bay-agent-controller.ts'

const rows = [
  { workbenchId: 'main' },
  { workbenchId: 'archived', archivedAt: 123 },
]

it('only targets an existing active Workbench', () => {
  expect(bayAgentWorkbenchTarget('main', rows)).toBe('main')
  expect(bayAgentWorkbenchTarget('archived', rows)).toBe('')
  expect(bayAgentWorkbenchTarget('missing', rows)).toBe('')
  expect(bayAgentWorkbenchTarget(undefined, rows)).toBe('')
})
