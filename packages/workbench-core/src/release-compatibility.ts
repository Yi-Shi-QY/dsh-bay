/** Workbench 18.x Core-only contract pinned to DSH 0.2.2-rc.3. */
export const WORKBENCH_PACKAGE_NAME = 'dsh-bay'
/** Historical package identity retained for audit data; the public v1 bundle reader never accepts it. */
export const WORKBENCH_LEGACY_PACKAGE_NAME = '@dsh-workbench/core'
export function isWorkbenchCorePackageName(value: unknown): value is typeof WORKBENCH_PACKAGE_NAME | typeof WORKBENCH_LEGACY_PACKAGE_NAME {
  return value === WORKBENCH_PACKAGE_NAME || value === WORKBENCH_LEGACY_PACKAGE_NAME
}
export const WORKBENCH_CORE_VERSION = '0.1.2'
export const WORKBENCH_SUITE_VERSION = '0.2.0-rc.4'
export const WORKBENCH_DSH_GENERATION = '0.2.2-rc.3'
export const WORKBENCH_UPSTREAM_COMMIT = 'ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c'
export const WORKBENCH_DSH_ENGINE_RANGE = '>=0.2.2-rc.3 <0.2.3'

/** Only the active RC3 generation is accepted by the new public bundle protocol. */
const WORKBENCH_PORTABLE_PACKAGE_DSH_GENERATIONS = new Set([WORKBENCH_DSH_GENERATION])
export function isWorkbenchPortablePackageDshGenerationCompatible(value: unknown): value is string {
  return typeof value === 'string' && WORKBENCH_PORTABLE_PACKAGE_DSH_GENERATIONS.has(value)
}

/**
 * Workbench bundles move between DSH builds of one release line: any 0.2.2
 * release or pre-release reads them, so a package is not rejected for a
 * different RC of the same generation.
 */
export function isWorkbenchBundleDshCompatible(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const line = (version: string) => /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version)?.slice(1, 4).join('.')
  const current = line(WORKBENCH_DSH_GENERATION)
  return current !== undefined && line(value) === current
}
