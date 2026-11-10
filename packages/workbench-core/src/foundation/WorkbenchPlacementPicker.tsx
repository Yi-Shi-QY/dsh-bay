import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { groupsOf, type DropEdge, type LayoutNode, type WorkbenchLayoutDocument } from './model.ts'
import css from './WorkbenchPlacementPicker.module.css'

const positions = [
  { edge: 'center', label: '加入标签' },
  { edge: 'left', label: '左侧分屏' },
  { edge: 'right', label: '右侧分屏' },
  { edge: 'top', label: '上方分屏' },
  { edge: 'bottom', label: '下方分屏' },
] as const

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
  const groups = groupsOf(layout.root)
  const [areaId, setAreaId] = useState(() => groups.some(group => group.id === layout.activeGroupId) ? layout.activeGroupId : groups[0]?.id ?? '')
  const [edge, setEdge] = useState<DropEdge>('center')
  const surface = useRef<HTMLElement>(null)
  useEffect(() => { surface.current?.focus({ preventScroll: true }) }, [])
  const descriptionId = useId()
  const selected = groups.find(group => group.id === areaId)
  const areaName = (id: string) => '区域 ' + (groups.findIndex(group => group.id === id) + 1)
  const blocked = !selected ? '目标区域已关闭，请重新选择。' : busy ? '内页正在处理其他操作，请稍后再试。' : reason(areaId, edge)
  const path = selected ? projectPath(areaId) : undefined
  const label = positions.find(position => position.edge === edge)!.label

  const renderLayout = (node: LayoutNode): ReactNode => {
    if (node.kind === 'split') {
      const ratio = Number.isFinite(node.ratio) ? Math.min(1, Math.max(0, node.ratio)) : .5
      const sizes = `minmax(0, ${ratio}fr) minmax(0, ${1 - ratio}fr)`
      return <div key={node.id} className={css.split} style={node.axis === 'horizontal' ? { gridTemplateColumns: sizes } : { gridTemplateRows: sizes }}>
        {renderLayout(node.first)}{renderLayout(node.second)}
      </div>
    }
    const activePage = node.tabs.find(tab => tab.id === node.activeTabId) ?? node.tabs[0]
    const current = activePage?.lastKnownTitle || '空区域'
    const name = areaName(node.id)
    return <button key={node.id} type="button" className={css.area} data-placement-area={node.id} aria-label={name + '：' + current}
      aria-pressed={node.id === areaId} title={name + ' · ' + current} onClick={() => setAreaId(node.id)}>
      {node.id === areaId ? <span className={css.highlight} data-placement-edge={edge} data-blocked={!!blocked} /> : null}
      <span className={css.areaCopy}><strong>{name}</strong><span>{current}</span></span>
    </button>
  }

  return <section ref={surface} tabIndex={-1} className={css.picker} aria-label="选择放置位置">
    <div className={css.source}><PlacementIcon edge="center" /><span>移动内页<strong title={title}>{title}</strong></span></div>
    <div className={css.scroll}>
      <div className={css.sectionHeading}><span>选择目标区域</span><small>点击布局预览</small></div>
      <div className={css.preview} role="group" aria-label="工作台布局预览">{renderLayout(layout.root)}</div>
      <div className={css.target}>
        <select aria-label="目标区域" value={selected ? areaId : ''} onChange={event => setAreaId(event.target.value)}>
          {!selected ? <option value="" disabled>重新选择区域</option> : null}
          {groups.map(group => <option key={group.id} value={group.id}>{areaName(group.id)}</option>)}
        </select>
        <span title={path ?? '未设置项目目录'}>{path ?? '未设置项目目录'}</span>
      </div>
      <div className={css.sectionHeading}><span>放置方式</span><small><i />高亮处为放置位置</small></div>
      <div className={css.positions} role="group" aria-label="放置方式">
        {positions.map(position => {
          const unavailable = selected ? reason(areaId, position.edge) : '请先选择区域'
          return <button key={position.edge} type="button" aria-pressed={edge === position.edge} data-unavailable={!!unavailable}
            title={unavailable ?? position.label} onClick={() => setEdge(position.edge)}>
            <PlacementIcon edge={position.edge} /><span>{position.label}</span>
          </button>
        })}
      </div>
      <p id={descriptionId} className={css.description} data-blocked={!!blocked} role="status">{blocked ?? (edge === 'center'
        ? `将「${title}」加入${areaName(areaId)}的标签页，保留现有内页。`
        : `在${areaName(areaId)}${label.slice(0, 2)}新建分屏，放入「${title}」。`)}</p>
    </div>
    <footer className={css.actions}><button type="button" onClick={onCancel}>取消</button><button type="button" className={css.confirm} disabled={!!blocked} aria-describedby={descriptionId}
      onClick={() => { if (selected && !busy) onConfirm(areaId, edge) }}>确认放入</button></footer>
  </section>
}
