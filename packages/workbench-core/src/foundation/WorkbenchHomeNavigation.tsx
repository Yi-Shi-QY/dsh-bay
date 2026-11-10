import { Button, IconClockOutlineMedium, IconChevronLeftOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import css from './WorkbenchHome.module.css'

export function WorkbenchHomeNavigation({ section, navigate }: { section?: 'workbenches' | 'sharing' | undefined; navigate: (options?: WorkbenchSettingsOpenOptionsV1) => void }) {
  return <nav className={css.navigation} aria-label="工作台总览导航">
    <div className={css.navigationPages}>
      {section ? <Button className={css.backButton} aria-label="返回总览" onClick={() => navigate()} icon={<IconChevronLeftOutlineMedium size={16} />}>总览</Button> : <button type="button" className={css.navLink} aria-current="page" onClick={() => navigate()}>全部工作台</button>}
      <button type="button" className={css.navLink} aria-current={section === 'sharing' ? 'page' : undefined} onClick={() => navigate({ section: 'sharing', shareMode: 'export' })}>分享与迁移</button>
    </div>
    {!section ? <Button size="sm" className={css.historyLink} icon={<IconClockOutlineMedium size={16} />} onClick={() => navigate({ section: 'sharing', shareMode: 'history' })}>导入记录</Button> : null}
  </nav>
}
