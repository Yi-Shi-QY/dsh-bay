import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/creator-host.ts'

describe('Core additions beside the official Creator tools', () => {
  it('registers only the Workbench tool and passes the exact Agent and cancellation to the official router', async () => {
    let tool: { name: string; execute(args: unknown, exec: unknown): Promise<unknown> } | undefined
    const expected = { version: 1, source: { revision: 19 } }
    const query = vi.fn(async () => expected)
    const section = vi.fn()
    apply({ tools: { register: (value: typeof tool) => { tool = value } }, systemPrompt: { section }, cordisInspect: { query } } as never)
    expect(tool?.name).toBe('workbench_inspect')
    expect(section).toHaveBeenCalledWith(expect.objectContaining({
      name: 'workbench:creator',
      text: expect.stringContaining('plugin_manager, action: install_bundle'),
    }))
    const prompt = section.mock.calls[0]?.[0].text as string
    expect(prompt).toContain('process-local API')
    expect(prompt).toContain('separate test Profile')
    expect(prompt).toContain('/create-workbench-extension')
    expect(prompt).toContain('Slot registrant')
    expect(prompt).toContain('inject()')
    expect(prompt).toContain('global current Session')
    expect(prompt).toContain('maxBytes/restore/share')
    expect(prompt).not.toContain('cordis_define')
    const agent = { id: 'creator-agent' }
    const signal = new AbortController().signal
    await expect(tool!.execute({}, { agent, signal })).resolves.toBe(expected)
    expect(query).toHaveBeenCalledWith('client', 'WorkbenchCreator', 'inspect', undefined, agent, signal)
    await expect(tool!.execute({}, { signal })).rejects.toThrow('Agent-backed session')
    expect(query).toHaveBeenCalledOnce()
  })
})
