/** Theme- and locale-aware confirmation for a pending native close request. */

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopCloseAction } from './desktop-bridge.ts'
import type { createDesktopUiStore } from './store.ts'
import css from './CloseDialog.module.css'

/** Close response callback injected by the desktop controller. */
export interface CloseDialogInjected {
  /** Resolve the pending native request. */
  resolveClose: (action: DesktopCloseAction, remember: boolean) => Promise<void>
}

/** Full close dialog props. */
export type CloseDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createDesktopUiStore>>
  & PropsLocale<'settings.desktop'>
  & CloseDialogInjected

/** Render the desktop close confirmation. */
export function CloseDialog({ t, useStore, resolveClose }: CloseDialogProps) {
  const open = useStore(state => state.promptOpen)
  const busy = useStore(state => state.busy)
  const failed = useStore(state => state.failed)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (open) setRemember(false)
  }, [open])

  const resolve = (action: DesktopCloseAction): void => {
    void resolveClose(action, remember)
  }

  return (
    <Modal
      open={open}
      onClose={() => { resolve('cancel') }}
      title={t('dialog.title')}
      closeLabel={t('dialog.close')}
      description={t('dialog.description')}
      className={css.dialog ?? ''}
      footer={(
        <div className={css.actions}>
          <Button variant="outline" disabled={busy} onClick={() => { resolve('cancel') }}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => { resolve('exit') }}>
            {t('dialog.exit')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => { resolve('minimize') }}>
            {t('dialog.minimize')}
          </Button>
        </div>
      )}
    >
      <label className={css.remember}>
        <input
          type="checkbox"
          checked={remember}
          disabled={busy}
          onChange={(event) => { setRemember(event.currentTarget.checked) }}
        />
        <span>{t('dialog.remember')}</span>
      </label>
      {failed && <p className={css.error} role="alert">{t('dialog.error')}</p>}
    </Modal>
  )
}
