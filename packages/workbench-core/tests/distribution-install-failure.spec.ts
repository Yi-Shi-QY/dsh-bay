import { describe, expect, it } from 'vitest'
import { installFailure } from '../src/host-distribution-installer.ts'

describe('installFailure', () => {
  it('names the package, keeps the pnpm error and points at the log', () => {
    const message = installFailure('@local/workbench-pomodoro', {
      output: 'Progress: resolved 1\n ERR_PNPM_NO_OFFLINE_TARBALL  A package is missing from the store: react@18.3.1\nDone in 1s',
      logPath: 'C:/profile/.plugin-manager/logs/operation-x/pnpm.log',
    })
    expect(message).toContain('@local/workbench-pomodoro')
    expect(message).toContain('ERR_PNPM_NO_OFFLINE_TARBALL')
    expect(message).not.toContain('Progress:')
    expect(message).toContain('operation-x/pnpm.log')
  })

  it('says so when pnpm went silent', () => {
    expect(installFailure('pkg', { timedOut: true })).toContain('长时间无输出')
  })
})
