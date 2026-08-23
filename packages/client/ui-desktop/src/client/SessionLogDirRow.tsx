/** General settings row choosing the Session log download directory. */

import { IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createDesktopUiStore } from './store.ts'
import css from './SessionLogDirRow.module.css'

/** Callbacks injected by the desktop plugin. */
export interface SessionLogDirRowInjected {
  /** Open the native folder picker and persist the picked directory. */
  pick: () => Promise<void>
}

/** Full session log directory row props. */
export type SessionLogDirRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createDesktopUiStore>>
  & PropsLocale<'settings.desktop'>
  & SessionLogDirRowInjected

/** Render the Session log download directory selector. */
export function SessionLogDirRow({ t, useStore, pick }: SessionLogDirRowProps) {
  const dir = useStore(state => state.sessionLogDir)
  const writable = useStore(state => state.writable)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.sessionlog.title')}</div>
        <div className={css.description}>{t('settings.sessionlog.description')}</div>
      </div>
      <button
        type="button"
        className={css.pathButton}
        disabled={!writable}
        aria-label={t('settings.sessionlog.pick')}
        title={dir === '' ? t('settings.sessionlog.default') : dir}
        onClick={() => { void pick() }}
      >
        <span className={css.pathValue}>{dir === '' ? t('settings.sessionlog.default') : dir}</span>
        <IconFolderOpen16 className={css.pathIcon} />
      </button>
    </div>
  )
}
