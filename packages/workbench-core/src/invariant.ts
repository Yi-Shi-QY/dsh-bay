import type { Context } from '@deepseek-ai/cordis'

type InvariantInstaller = () => void | Promise<void>
type InvariantRegistry = { register(name: string, installer: InvariantInstaller): unknown }

export const name = 'workbench-core-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: Core's install transaction and receipt relationships
 * are checked inside its coordinator; it emits no public Cordis events for
 * them. Settings mutations use the official settings invariant owner.
 */
const install: InvariantInstaller = () => {}

/** Register the companion used by the locked upstream composition tests. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve((ctx as Context & { invariants: InvariantRegistry }).invariants.register('dsh-bay', install) as () => void)
