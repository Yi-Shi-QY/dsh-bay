import { useWorkbenchLocale } from './workbench-locale.ts'
import { cloneElement, useEffect, useState, type ComponentProps } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchAreaTabSummary } from './area-tab-rows.ts'

/** Clone the anchor so tab sizing, refs, roving focus and drag handling stay intact. */
export function WorkbenchTabTooltip({ summary, children, disabled = false, side = 'bottom' }: {
  summary: WorkbenchAreaTabSummary
  children: ComponentProps<typeof Tooltip>['children']
  disabled?: boolean
  side?: ComponentProps<typeof Tooltip>['side']
}) {
  const { t } = useWorkbenchLocale()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!hovered && !focused) { setDismissed(false); return }
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setDismissed(true) }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [hovered, focused])
  return <Tooltip label={summary.information?.tooltip ?? `${summary.title}\n${t('tab.info.status', { status: summary.statusLabel })}`}
    portal delayMs={350} focusDelayMs={200} maxWidth={420} side={side} disabled={disabled || dismissed}>
    {cloneElement(children, {
      onPointerEnter: event => { children.props.onPointerEnter?.(event); setHovered(true) },
      onPointerLeave: event => { children.props.onPointerLeave?.(event); setHovered(false) },
      onFocus: event => { children.props.onFocus?.(event); setFocused(true) },
      onBlur: event => { children.props.onBlur?.(event); setFocused(false) },
      onPointerDown: event => { children.props.onPointerDown?.(event); setDismissed(true) },
    })}
  </Tooltip>
}
