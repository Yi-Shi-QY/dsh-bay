import { useWorkbenchLocale } from './workbench-locale.ts'
import { Button, IconClockOutlineMedium, IconChevronLeftOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchSettingsOpenOptionsV1 } from './settings-context.ts'
import css from './WorkbenchHome.module.css'

export function WorkbenchHomeNavigation({ section, navigate }: { section?: 'workbenches' | 'sharing' | undefined; navigate: (options?: WorkbenchSettingsOpenOptionsV1) => void }) {
  const { t } = useWorkbenchLocale()
  return <nav className={css.navigation} aria-label={t('home.workbenchOverviewNavigation')}>
    <div className={css.navigationPages}>
      {section ? <Button className={css.backButton} aria-label={t('home.backToOverview')} onClick={() => navigate()} icon={<IconChevronLeftOutlineMedium size={16} />}>{t('home.overview')}</Button> : <button type="button" className={css.navLink} aria-current="page" onClick={() => navigate()}>{t('home.allWorkbenches')}</button>}
      <button type="button" className={css.navLink} aria-current={section === 'sharing' ? 'page' : undefined} onClick={() => navigate({ section: 'sharing', shareMode: 'export' })}>{t('home.sharingAndTransfer')}</button>
    </div>
    {!section ? <Button size="sm" className={css.historyLink} icon={<IconClockOutlineMedium size={16} />} onClick={() => navigate({ section: 'sharing', shareMode: 'history' })}>{t('home.importHistory')}</Button> : null}
  </nav>
}
