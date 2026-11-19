import { useWorkbenchLocale, workbenchPageTitle } from './workbench-locale.ts'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { groupsOf, type DropEdge, type LayoutNode, type WorkbenchLayoutDocument } from './model.ts'
import css from './WorkbenchPlacementPicker.module.css'

const positions = ['center', 'left', 'right', 'top', 'bottom'] as const satisfies readonly DropEdge[]

interface Props {
  layout: WorkbenchLayoutDocument
  title: string
  busy: boolean
  reason: (areaId: string, edge: DropEdge) => string | undefined
  projectPath: (areaId: string) => string | undefined
  onConfirm: (areaId: string, edge: DropEdge) => void
  onCancel: () => void
}

function PlacementIcon({ edge }: { edge: DropEdge }) {
  const horizontal = edge === 'left' || edge === 'right'
  return <svg width="24" height="20" viewBox="0 0 24 20" fill="none" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.3" opacity=".55" />
    {edge === 'center' ? <><path d="M2 7h20M9 2v5" stroke="currentColor" strokeWidth="1.3" /><rect x="3" y="3" width="4.5" height="2.5" rx=".7" fill="currentColor" /></>
      : <><rect x={edge === 'right' ? 12.5 : 3} y={edge === 'bottom' ? 10.5 : 3} width={horizontal ? 8.5 : 18} height={horizontal ? 14 : 6.5} rx="1" fill="currentColor" opacity=".6" /><path d={horizontal ? 'M12 2v16' : 'M2 10h20'} stroke="currentColor" strokeWidth="1.1" /></>}
  </svg>
}

/** Preview is local state only; all placement validation and writes stay with the caller. */
export function WorkbenchPlacementPicker({ layout, title, busy, reason, projectPath, onConfirm, onCancel }: Props) {
  const { t } = useWorkbenchLocale()
  const groups = groupsOf(layout.root)
  const [areaId, setAreaId] = useState(() => groups.some(group => group.id === layout.activeGroupId) ? layout.activeGroupId : groups[0]?.id ?? '')
  const [edge, setEdge] = useState<DropEdge>('center')
  const surface = useRef<HTMLElement>(null)
  useEffect(() => { surface.current?.focus({ preventScroll: true }) }, [])
  const descriptionId = useId()
  const selected = groups.find(group => group.id === areaId)
  const areaName = (id: string) => t('page.area', { index: groups.findIndex(group => group.id === id) + 1 })
  const blocked = !selected ? t('layout.closedDestination') : busy ? t('layout.pageBusy') : reason(areaId, edge)
  const path = selected ? projectPath(areaId) : undefined

  const renderLayout = (node: LayoutNode): ReactNode => {
    if (node.kind === 'split') {
      const ratio = Number.isFinite(node.ratio) ? Math.min(1, Math.max(0, node.ratio)) : .5
      const sizes = `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`
      return <div key={node.id} className={css.split} style={node.axis === 'horizontal' ? { gridTemplateColumns: sizes } : { gridTemplateRows: sizes }}>
        {renderLayout(node.first)}{renderLayout(node.second)}
      </div>
    }
    const activePage = node.tabs.find(tab => tab.id === node.activeTabId) ?? node.tabs[0]
    const current = activePage ? workbenchPageTitle(t, activePage.editorId, activePage.lastKnownTitle) : t('placement.emptyArea')
    const name = areaName(node.id)
    return <button key={node.id} type="button" className={css.area} data-placement-area={node.id} aria-label={name + '：' + current}
      aria-pressed={node.id === areaId} title={name + ' · ' + current} onClick={() => setAreaId(node.id)}>
      {node.id === areaId ? <span className={css.highlight} data-placement-edge={edge} data-blocked={!!blocked} /> : null}
      <span className={css.areaCopy}><strong>{name}</strong><span>{current}</span></span>
    </button>
  }

  return <section ref={surface} tabIndex={-1} className={css.picker} aria-label={t('workspace.chooseWhereToPlaceThePage')}>
    <div className={css.source}><PlacementIcon edge="center" /><span>{t('workspace.movePage')}<strong title={title}>{title}</strong></span></div>
    <div className={css.scroll}>
      <div className={css.sectionHeading}><span>{t('workspace.chooseDestinationArea')}</span><small>{t('workspace.selectAnAreaInTheLayoutPreview')}</small></div>
      <div className={css.preview} role="group" aria-label={t('workspace.workbenchLayoutPreview')}>{renderLayout(layout.root)}</div>
      <div className={css.target}>
        <select aria-label={t('workspace.destinationArea')} value={selected ? areaId : ''} onChange={event => setAreaId(event.target.value)}>
          {!selected ? <option value="" disabled>{t('workspace.chooseAnotherArea')}</option> : null}
          {groups.map(group => <option key={group.id} value={group.id}>{areaName(group.id)}</option>)}
        </select>
        <span title={path ?? t('layout.projectFolderNotSet')}>{path ?? t('layout.projectFolderNotSet')}</span>
      </div>
      <div className={css.sectionHeading}><span>{t('workspace.placement')}</span><small><i />{t('workspace.theHighlightShowsWhereThePageWill')}</small></div>
      <div className={css.positions} role="group" aria-label={t('workspace.placement')}>
        {positions.map(positionEdge => {
          const unavailable = selected ? reason(areaId, positionEdge) : t('layout.chooseAreaFirst')
          return <button key={positionEdge} type="button" aria-pressed={edge === positionEdge} data-unavailable={!!unavailable}
            title={unavailable ?? t(`layout.place.${positionEdge}`)} onClick={() => setEdge(positionEdge)}>
            <PlacementIcon edge={positionEdge} /><span>{t(`layout.place.${positionEdge}`)}</span>
          </button>
        })}
      </div>
      <p id={descriptionId} className={css.description} data-blocked={!!blocked} role="status">{blocked ?? (edge === 'center'
        ? t('layout.placeTabHint', { title, area: areaName(areaId) })
        : t(`layout.placeHint.${edge}`, { title, area: areaName(areaId) }))}</p>
    </div>
    <footer className={css.actions}><button type="button" onClick={onCancel}>{t('action.cancel')}</button><button type="button" className={css.confirm} disabled={!!blocked} aria-describedby={descriptionId}
      onClick={() => { if (selected && !busy) onConfirm(areaId, edge) }}>{t('workspace.movePageHere')}</button></footer>
  </section>
}
