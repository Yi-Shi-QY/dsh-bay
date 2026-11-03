// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativePluginNavigation } from '../src/client/native-plugin-navigation.ts'
import { createWorkbenchModeController } from '../src/mode-controller.ts'
import { WorkbenchModuleManagerSection } from '../src/foundation/WorkbenchModuleManagerSection.tsx'

afterEach(cleanup)

function bench(flush = async () => true) {
  const mode = createWorkbenchModeController({ flush })
  let available = true
  const listeners = new Set<() => void>()
  const selectPanel = vi.fn()
  const navigation = createNativePluginNavigation({ mode, available: () => available, selectPanel,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } })
  return { mode, navigation, selectPanel, availability(value: boolean) { available = value; for (const fn of listeners) fn() } }
}

describe('native DSH plugin management handoff', () => {
  it('flushes the Workbench before selecting the native panel and also works from official settings', async () => {
    const flush = vi.fn(async () => true)
    const b = bench(flush)
    await b.mode.enter()
    await b.navigation.open()
    expect(flush).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledOnce()
    expect(b.mode.getSnapshot().mode).toBe('official')
    await b.navigation.open()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledOnce()
  })

  it('preserves the Workbench and never navigates when its layout cannot be saved', async () => {
    const b = bench(async () => false)
    await b.mode.enter()
    await expect(b.navigation.open()).rejects.toThrow('布局已保存')
    expect(b.selectPanel).not.toHaveBeenCalled()
    expect(b.mode.getSnapshot().mode).toBe('workbench')
  })

  it('rechecks the native panel after the asynchronous layout flush', async () => {
    let release!: (value: boolean) => void
    const b = bench(() => new Promise<boolean>(resolve => { release = resolve }))
    await b.mode.enter()
    const opening = b.navigation.open()
    b.availability(false)
    release(true)
    await expect(opening).rejects.toThrow('原生插件管理已启用')
    expect(b.selectPanel).not.toHaveBeenCalled()
    expect(b.mode.getSnapshot().mode).toBe('workbench')
  })

  it('only renders the handoff for an available native panel and closes settings after success', async () => {
    const b = bench()
    const close = vi.fn()
    b.availability(false)
    const view = render(<WorkbenchModuleManagerSection nativePluginNavigation={b.navigation} close={close} />)
    expect(view.queryByRole('button', { name: '打开 DSH 原生插件管理' })).toBeNull()
    act(() => b.availability(true))
    fireEvent.click(view.getByRole('button', { name: '打开 DSH 原生插件管理' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(b.selectPanel).toHaveBeenCalledOnce()
  })

  it('shows Core bundled official editors without offering a legacy Suite install', () => {
    const editorIds = [
      ['workbench.workspace-files', '工作区文件', 'session'],
      ['workbench.terminal', '终端', 'session'],
      ['workbench.browser', '浏览器', 'root'],
      ['workbench.conversation.start', '新建对话', 'root'],
      ['workbench.conversation', '对话', 'session'],
      ['workbench.agent-trajectory', 'Agent 轨迹', 'session'],
    ] as const
    const editorSnapshot = editorIds.map(([id, label, scope]) => ({ id, label, scope }))
    const editorCatalog = {
      getSnapshot: () => editorSnapshot,
      subscribe: () => () => {},
    }
    const view = render(<WorkbenchModuleManagerSection editorCatalog={editorCatalog as never} />)
    expect(view.getByRole('heading', { name: 'Workbench Core 官方内置' })).toBeTruthy()
    expect(view.getByText('随 Core 已就绪')).toBeTruthy()
    expect(view.getByText(/不需要单独安装或导入 Conversation Suite/)).toBeTruthy()
    expect(view.queryByRole('button', { name: /安装功能扩展|补齐官方内置组件/ })).toBeNull()
  })
})
