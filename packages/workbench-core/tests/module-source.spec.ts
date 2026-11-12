import { describe, expect, it } from 'vitest'
import {
  classifyWorkbenchSourceUpdate,
  workbenchCoreCompatibilitySatisfies,
  sameWorkbenchModuleSource,
  validateWorkbenchModuleSource,
  validateWorkbenchModuleSourceRequest,
} from '../src/module-source.ts'

const npm = (version = '1.2.3') => ({ kind: 'npm' as const, packageName: '@dsh-workbench/example', resolvedVersion: version, artifactDigest: 'a'.repeat(64), registry: 'https://registry.example.test' })
const git = (commit = 'a'.repeat(40)) => ({ kind: 'git' as const, repository: 'https://github.com/example/workbench.git', resolvedCommit: commit, artifactDigest: 'b'.repeat(64) })

describe('Workbench module source identity', () => {
  it('accepts compatible ranges and previous exact 18.x Core declarations', () => {
    expect(workbenchCoreCompatibilitySatisfies('0.2.2-alpha.18.1', '0.2.2-alpha.18.0')).toBe(true)
    expect(workbenchCoreCompatibilitySatisfies('0.2.2-alpha.18.1', '>=0.2.2-alpha.18.0 <0.2.2-alpha.19.0')).toBe(true)
    expect(workbenchCoreCompatibilitySatisfies('0.2.2-alpha.18.1', '0.2.2-alpha.17.6')).toBe(false)
    expect(workbenchCoreCompatibilitySatisfies('0.2.2-alpha.18.1', '0.2.2-alpha.18.2')).toBe(false)
  })

  it('accepts explicit npm and git requests but rejects locators that can execute commands', () => {
    expect(validateWorkbenchModuleSourceRequest({ kind: 'npm', packageName: '@dsh-workbench/example', requestedRange: '^1.2.0' })).toBe(true)
    expect(validateWorkbenchModuleSourceRequest({ kind: 'git', repository: 'https://github.com/example/workbench.git', ref: 'refs/tags/v1.2.3', subpath: 'packages/module' })).toBe(true)
    expect(validateWorkbenchModuleSourceRequest({ kind: 'npm', packageName: 'example; rm -rf .' })).toBe(false)
    expect(validateWorkbenchModuleSourceRequest({ kind: 'git', repository: 'http://github.com/example/workbench.git', ref: 'main' })).toBe(false)
    expect(validateWorkbenchModuleSourceRequest({ kind: 'git', repository: 'https://github.com/example/workbench.git', ref: 'main', subpath: '../secret' })).toBe(false)
  })

  it('requires exact resolved identities before a receipt can be trusted', () => {
    expect(validateWorkbenchModuleSource(npm())).toBe(true)
    expect(validateWorkbenchModuleSource(git())).toBe(true)
    expect(validateWorkbenchModuleSource({ ...npm(), resolvedVersion: 'latest' })).toBe(false)
    expect(validateWorkbenchModuleSource({ ...git(), resolvedCommit: 'main' })).toBe(false)
    expect(sameWorkbenchModuleSource(npm(), npm())).toBe(true)
    expect(sameWorkbenchModuleSource(npm(), git())).toBe(false)
  })

  it('separates same-source update, current version, downgrade and source changes', () => {
    expect(classifyWorkbenchSourceUpdate(npm('1.2.3'), npm('1.3.0'))).toBe('update-available')
    expect(classifyWorkbenchSourceUpdate(npm('1.2.3'), npm('1.2.3'))).toBe('current')
    expect(classifyWorkbenchSourceUpdate(npm('1.2.3'), npm('1.1.9'))).toBe('downgrade')
    expect(classifyWorkbenchSourceUpdate(npm('1.2.3'), { ...npm('1.2.3'), artifactDigest: 'c'.repeat(64) })).toBe('identity-conflict')
    expect(classifyWorkbenchSourceUpdate(npm(), { ...npm(), registry: 'https://mirror.example.test' })).toBe('source-change')
    expect(classifyWorkbenchSourceUpdate(git('a'.repeat(40)), git('b'.repeat(40)))).toBe('update-available')
    expect(classifyWorkbenchSourceUpdate(git(), npm())).toBe('source-change')
  })

})
