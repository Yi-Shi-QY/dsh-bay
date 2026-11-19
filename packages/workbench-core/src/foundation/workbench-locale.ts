import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WORKBENCH_LOCALE_NAMESPACE, workbenchMessages, type WorkbenchMessageKey } from './workbench-messages.ts'

export type WorkbenchLocaleSource = Pick<LocaleRuntime, 'bind' | 'getSnapshot' | 'subscribe'>
export type WorkbenchTranslate = (key: WorkbenchMessageKey, params?: Record<string, string | number>) => string

export type WorkbenchNotice = { key: WorkbenchMessageKey; params?: Record<string, string | number> } | { detail: string }

export function workbenchNoticeText(t: WorkbenchTranslate, notice?: WorkbenchNotice): string | undefined {
  return notice === undefined ? undefined : 'key' in notice ? t(notice.key, notice.params) : notice.detail
}

export function workbenchErrorNotice(error: unknown, fallback: WorkbenchMessageKey): WorkbenchNotice {
  return error instanceof WorkbenchMessageError ? error.notice : error instanceof Error ? { detail: error.message } : { key: fallback }
}

export class WorkbenchMessageError extends Error {
  readonly notice: Extract<WorkbenchNotice, { key: WorkbenchMessageKey }>

  constructor(key: WorkbenchMessageKey, params?: Record<string, string | number>) {
    super(defaultWorkbenchTranslate(key, params))
    this.notice = { key, ...(params === undefined ? {} : { params }) }
  }
}

export const WorkbenchLocaleContext = createContext<WorkbenchLocaleSource | undefined>(undefined)

export function translateWorkbenchMessage(language: string, key: WorkbenchMessageKey, params?: Record<string, string | number>): string {
  const dict = language === 'zh' ? workbenchMessages.zh : workbenchMessages.en
  return dict[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params?.[name] === undefined ? placeholder : String(params[name]))
}

export const defaultWorkbenchTranslate: WorkbenchTranslate = (key, params) => translateWorkbenchMessage('zh', key, params)

export function useWorkbenchLocale(injected?: WorkbenchLocaleSource) {
  const context = useContext(WorkbenchLocaleContext)
  const locale = injected ?? context
  const source = useMemo(() => ({
    subscribe: (listener: () => void) => locale?.subscribe(listener) ?? (() => {}),
    getSnapshot: () => locale?.getSnapshot(),
    translate: locale?.bind(WORKBENCH_LOCALE_NAMESPACE),
  }), [locale])
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  return useMemo(() => {
    const t: WorkbenchTranslate = (key, params) => source.translate?.(key, params) ?? defaultWorkbenchTranslate(key, params)
    return { t, language: snapshot?.active }
  }, [source, snapshot])
}

export function workbenchPageTitle(t: WorkbenchTranslate, editorId: string, title: string): string {
  const key = `editor.${editorId}` as WorkbenchMessageKey
  if (!Object.hasOwn(workbenchMessages.zh, key)) return title
  return title === workbenchMessages.zh[key] || title === workbenchMessages.en[key] ? t(key) : title
}

export function workbenchIntlLocale(language?: string): string {
  return language === undefined || language === 'zh' ? 'zh-CN' : language
}
