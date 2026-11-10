// @vitest-environment jsdom
import React from 'react'
import {it,expect,vi,afterEach} from 'vitest'
import {render,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {WorkbenchDistributionPage} from '../src/foundation/WorkbenchDistributionPage.tsx'
import {settingsFixture} from './settings-fixtures.ts'
afterEach(cleanup)
it('resumes a confirmed installation after reconnect without requesting consent again',async()=>{
  const f=fixture();f.service.history.mockResolvedValue([{...f.row,state:'installing'}])
  const view=render(<WorkbenchDistributionPage {...f.props as never}/>)
  await waitFor(()=>expect(view.getByText('接收工作台')).toBeDefined())
  fireEvent.click(view.getByRole('button',{name:'查看与继续'}))
  expect(view.queryByRole('checkbox')).toBeNull()
  expect(view.getByRole('button',{name:'检查并继续此事务'})).toBeDefined()
})
function fixture(){
  const row={transactionId:'distribution-a',archiveSha256:'a'.repeat(64),workbenchId:'new',name:'接收工作台',createdAt:1,mode:'offline-embedded',keyId:'b'.repeat(64),state:'checked',dependencies:[],installed:[],reused:[],blockers:[]}
  const service={history:vi.fn(async()=>[row]),confirm:vi.fn(async()=>({...row,state:'ready'})),resume:vi.fn(),cancel:vi.fn(),prepareExport:vi.fn(),restorePending:vi.fn()}
  const openAndSelect=vi.fn(async()=>({status:'committed'}))
  const props={value:settingsFixture(),editors:[],useSessions:()=>({ids:[],byId:{}}),distributionPackage:service,workbenchDirectory:{openAndSelect},openOptions:{shareMode:'history'}}
  return {row,service,props,openAndSelect}
}
it('shows three distinct modes and requires confirmation before importing',async()=>{
  const f=fixture(),view=render(<WorkbenchDistributionPage {...f.props as never}/>)
  await waitFor(()=>expect(view.getByText('接收工作台')).toBeDefined())
  fireEvent.click(view.getByRole('button',{name:'查看与继续'}))
  const button=view.getByRole('button',{name:'确认导入'}) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(view.getByRole('checkbox'));fireEvent.click(button)
  await waitFor(()=>expect(f.service.confirm).toHaveBeenCalledTimes(1))
  await waitFor(()=>expect(view.getByRole('button',{name:'打开导入的工作台'})).toBeDefined())
  expect(f.openAndSelect).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button',{name:'打开导入的工作台'}));expect(f.openAndSelect).toHaveBeenCalledWith('new')
  fireEvent.click(view.getByRole('button',{name:'导出工作台'}))
  const select=view.getByLabelText('导出模式') as HTMLSelectElement
  expect([...select.options].map(o=>o.value)).toEqual(['layout-only','online-reference','offline-embedded'])
})
it('renders the export preview with the workbench layout summary',async()=>{
  const f=fixture(),settings=settingsFixture(),document=settings.workbenches.a!.document
  f.props.openOptions={shareMode:'export',workbenchId:'a'}
  f.service.prepareExport.mockResolvedValue({preview:{layout:{name:'AAA',description:'工作台说明',tags:['研发'],document,warnings:[]},manifest:{dependencies:[]}},bytes:new Uint8Array([1])})
  const view=render(<WorkbenchDistributionPage {...f.props as never}/>)
  fireEvent.click(view.getByRole('button',{name:'保存布局并生成分享包'}))
  await waitFor(()=>expect(view.getByText('布局概览')).toBeDefined())
  expect(view.getByText('当前分享包不包含额外扩展。')).toBeDefined()
  expect(view.getByText('工作台说明')).toBeDefined()
})
it('refreshes durable transaction status after restore fails instead of losing the resume action',async()=>{
  const f=fixture();f.service.confirm.mockRejectedValue(new Error('配置恢复失败'))
  const view=render(<WorkbenchDistributionPage {...f.props as never}/>)
  await waitFor(()=>expect(view.getByText('接收工作台')).toBeDefined())
  fireEvent.click(view.getByRole('button',{name:'查看与继续'}))
  f.service.history.mockResolvedValue([{...f.row,state:'awaiting-restore'}])
  fireEvent.click(view.getByRole('checkbox'));fireEvent.click(view.getByRole('button',{name:'确认导入'}))
  await waitFor(()=>expect(view.getByRole('button',{name:'检查并继续此事务'})).toBeDefined())
  expect(f.service.history).toHaveBeenCalledTimes(2)
})
it('uses the shell open action so a completed import can leave Home',async()=>{
  const f=fixture(),onOpenWorkbench=vi.fn(async()=>{})
  f.service.history.mockResolvedValue([{...f.row,state:'ready'}])
  const view=render(<WorkbenchDistributionPage {...f.props as never} onOpenWorkbench={onOpenWorkbench}/>)
  await waitFor(()=>expect(view.getByText('接收工作台')).toBeDefined())
  fireEvent.click(view.getByRole('button',{name:'查看与继续'}))
  fireEvent.click(view.getByRole('button',{name:'打开导入的工作台'}))
  expect(onOpenWorkbench).toHaveBeenCalledWith('new');expect(f.openAndSelect).not.toHaveBeenCalled()
})
