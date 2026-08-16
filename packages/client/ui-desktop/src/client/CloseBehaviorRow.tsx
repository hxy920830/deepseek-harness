/** General settings row for the main-window close behavior. */

import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopCloseBehavior } from '../settings.ts'
import type { DesktopKey } from './locales.ts'
import type { createDesktopUiStore } from './store.ts'
import css from './CloseBehaviorRow.module.css'

/** Callbacks injected by the desktop plugin. */
export interface CloseBehaviorRowInjected {
  /** Persist the selected close behavior. */
  setBehavior: (behavior: DesktopCloseBehavior) => void
}

/** Full close behavior row props. */
export type CloseBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createDesktopUiStore>>
  & PropsLocale<'settings.desktop'>
  & CloseBehaviorRowInjected

const OPTIONS = [
  { id: 'ask', label: 'settings.close.ask' },
  { id: 'minimize', label: 'settings.close.minimize' },
  { id: 'exit', label: 'settings.close.exit' },
] as const satisfies readonly { id: DesktopCloseBehavior; label: DesktopKey }[]

/** Render the desktop close behavior selector. */
export function CloseBehaviorRow({ t, useStore, setBehavior }: CloseBehaviorRowProps) {
  const behavior = useStore(state => state.behavior)
  const writable = useStore(state => state.writable)
  const [open, setOpen] = useState(false)
  const selected = OPTIONS.find(option => option.id === behavior) ?? OPTIONS[0]

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.close.title')}</div>
        <div className={css.description}>{t('settings.close.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={behavior}
        onSelect={(id) => {
          setOpen(false)
          setBehavior(id as DesktopCloseBehavior)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            disabled={!writable}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selected.label)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
