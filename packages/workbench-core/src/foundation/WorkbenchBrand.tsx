import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Official mark used by the Workbench development composition. */
export function WorkbenchBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/** Official wordmark used by the Workbench development composition. */
export function WorkbenchBrandName() {
  return <BrandWordmark includeMark={false} />
}
