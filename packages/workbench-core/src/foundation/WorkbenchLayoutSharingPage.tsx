import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { WorkbenchSharingPage } from './WorkbenchSharingPage.tsx'

/** Layout-only archives are no longer a public protocol; use dshbay-workbench v1. */
export function WorkbenchLayoutSharingPage(props: SettingsPageProps) {
  return <WorkbenchSharingPage {...props} />
}
