import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import { WORKBENCH_LOCALE_NAMESPACE, workbenchMessages } from '../src/foundation/workbench-messages.ts'

export function createTestWorkbenchLocale(register = true) {
  const locale = new LocaleRuntime({ emit: () => {} } as ConstructorParameters<typeof LocaleRuntime>[0])
  if (register) locale.register(WORKBENCH_LOCALE_NAMESPACE, workbenchMessages)
  locale.setLocale('zh')
  return locale
}
