import type { WorkbenchAreaTabSummary } from './area-tab-rows.ts'
import css from './WorkbenchFrame.module.css'

/** Shared by the tab strip, overview and collapsed preview. The parent owns interaction and accessible text. */
export function WorkbenchTabStatus({ summary }: { summary: Pick<WorkbenchAreaTabSummary, 'status' | 'conversation'> }) {
  return <span className={css.areaTabStatusDot} data-tab-status={summary.status}
    data-conversation-status={summary.conversation || undefined} aria-hidden="true" />
}
