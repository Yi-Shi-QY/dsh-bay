import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchCreatorSkillProvider, installWorkbenchCreatorSkillProvider, WORKBENCH_EXTENSION_SKILL_NAME } from '../src/workbench-creator-skill.ts'

describe('Workbench global Creator Skill', () => {
  it('exposes the extension contract through the native Skill provider shape', async () => {
    const load = vi.fn(async () => '---\nname: workbench-extension-development\ndescription: test\n---\n# Contract')
    const provider = createWorkbenchCreatorSkillProvider(load)
    const [candidate] = await provider.list({})
    expect(candidate?.name).toBe(WORKBENCH_EXTENSION_SKILL_NAME)
    expect(candidate?.source).toBe('bundled')
    expect(candidate?.provider).toBe('workbench-core')
    const definition = await provider.get(candidate!, {})
    expect(definition?.content).toBe('# Contract')
    expect(load).toHaveBeenCalledOnce()
  })

  it('registers and disposes from the global registry', () => {
    const dispose = vi.fn()
    const registerProvider = vi.fn(() => dispose)
    const registered = installWorkbenchCreatorSkillProvider({ registerProvider } as never)
    expect(registerProvider).toHaveBeenCalledOnce()
    registered?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
