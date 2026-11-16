/** Public beta Core contract pinned to DSH 0.2.2-rc.2. */
export const WORKBENCH_PACKAGE_NAME = 'dsh-bay'
/** Read compatibility for previously exported workbench archives; never emit this name. */
export const WORKBENCH_LEGACY_PACKAGE_NAME = '@dsh-workbench/core'
export function isWorkbenchCorePackageName(value: unknown): value is typeof WORKBENCH_PACKAGE_NAME | typeof WORKBENCH_LEGACY_PACKAGE_NAME {
  return value === WORKBENCH_PACKAGE_NAME || value === WORKBENCH_LEGACY_PACKAGE_NAME
}
export const WORKBENCH_CORE_VERSION = '0.1.0-beta.1'
export const WORKBENCH_SUITE_VERSION = '0.2.0-rc.4'
export const WORKBENCH_DSH_GENERATION = '0.2.2-rc.2'
export const WORKBENCH_UPSTREAM_COMMIT = 'ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c'
export const WORKBENCH_DSH_ENGINE_RANGE = '>=0.2.2-rc.2 <0.2.3'

/** RC1 archives remain readable because their data schemas are validated separately from the DSH runtime API. */
const WORKBENCH_PORTABLE_PACKAGE_DSH_GENERATIONS = new Set(['0.2.2-rc.1', WORKBENCH_DSH_GENERATION])
export function isWorkbenchPortablePackageDshGenerationCompatible(value: unknown): value is string {
  return typeof value === 'string' && WORKBENCH_PORTABLE_PACKAGE_DSH_GENERATIONS.has(value)
}
