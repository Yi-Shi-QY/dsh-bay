import { describe, expect, it, vi } from 'vitest'
import {
  createWorkbenchCreatorSkillProvider,
  installWorkbenchCreatorSkillProvider,
  CREATE_WORKBENCH_EXTENSION_SKILL_NAME,
  WORKBENCH_EXTENSION_SKILL_NAME,
} from '../src/workbench-creator-skill.ts'

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

  it('exposes a short user-invocable Creator shortcut without changing the canonical model skill', async () => {
    const load = vi.fn(async () => '---\nname: workbench-extension-development\ndescription: test\n---\n# Contract')
    const provider = createWorkbenchCreatorSkillProvider(load)
    const candidates = await provider.list({})
    const shortcut = candidates.find(candidate => candidate.name === CREATE_WORKBENCH_EXTENSION_SKILL_NAME)
    const canonical = candidates.find(candidate => candidate.name === WORKBENCH_EXTENSION_SKILL_NAME)

    expect(shortcut?.description).toContain('Create a Workbench inner-page extension')
    expect(shortcut?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(canonical?.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    await expect(provider.get(shortcut!, {})).resolves.toMatchObject({
      name: CREATE_WORKBENCH_EXTENSION_SKILL_NAME,
      content: '# Contract',
    })
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
