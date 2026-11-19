import { describe, expect, it } from 'vitest'
import { workbenchMessages, type WorkbenchMessageKey } from '../src/foundation/workbench-messages.ts'

const placeholders = (message: string) => [...new Set(message.match(/\{\w+\}/g) ?? [])].sort()

describe('Workbench messages', () => {
  it('provides nonempty Chinese and English copy with identical placeholders', () => {
    const { zh, en } = workbenchMessages
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(zh) as WorkbenchMessageKey[]) {
      expect(zh[key].trim(), key).not.toBe('')
      expect(en[key].trim(), key).not.toBe('')
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })
})
