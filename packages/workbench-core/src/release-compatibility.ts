/** Workbench 17.6 Core-only contract pinned to DSH 0.2.2-rc.1. */
export const WORKBENCH_PACKAGE_NAME = 'dsh-bay'
/** Read compatibility for previously exported workbench archives; never emit this name. */
export const WORKBENCH_LEGACY_PACKAGE_NAME = '@dsh-workbench/core'
export function isWorkbenchCorePackageName(value: unknown): value is typeof WORKBENCH_PACKAGE_NAME | typeof WORKBENCH_LEGACY_PACKAGE_NAME {
  return value === WORKBENCH_PACKAGE_NAME || value === WORKBENCH_LEGACY_PACKAGE_NAME
}
export const WORKBENCH_CORE_VERSION = '0.2.2-alpha.17.6'
export const WORKBENCH_SUITE_VERSION = '0.2.0-rc.4'
export const WORKBENCH_DSH_GENERATION = '0.2.2-rc.1'
export const WORKBENCH_UPSTREAM_COMMIT = '66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db'
