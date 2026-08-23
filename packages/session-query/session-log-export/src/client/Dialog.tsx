import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the Session Header contribution. */
export interface SessionLogDownloadDialogInjected {
  hooks: { sessionLogDownload: ObservableSnapshot<SessionLogDownloadState> }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
  /** Reveal one saved archive in the native file manager. */
  revealSaved: (sessionId: SessionId) => Promise<void>
  /** Open one saved archive with its default handler. */
  openSaved: (sessionId: SessionId) => Promise<void>
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Modal shared by the Session Header button and this browser's `/export` command.
 * A natively saved archive additionally offers reveal and open actions.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t, revealSaved, openSaved,
}: SessionLogDownloadDialogProps) {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const [actionError, setActionError] = useState(false)
  const [busyAction, setBusyAction] = useState<'reveal' | 'open' | null>(null)

  useEffect(() => {
    setActionError(false)
    setBusyAction(null)
  }, [entry?.filePath])

  const status = entry?.status
  const open = entry?.open === true
  const filePath = status === 'success' ? entry?.filePath ?? null : null
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success'
      ? (filePath !== null ? t('dialog.savedTitle') : t('dialog.successTitle'))
      : t('dialog.errorTitle')
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success'
      ? (filePath ?? t('dialog.successDescription'))
      : error ?? t('dialog.commandFailed')

  const runAction = (action: 'reveal' | 'open'): void => {
    setActionError(false)
    setBusyAction(action)
    const settled = action === 'reveal' ? revealSaved(sessionId) : openSaved(sessionId)
    void settled
      .catch(() => { setActionError(true) })
      .finally(() => { setBusyAction(null) })
  }

  const footer = filePath !== null
    ? (
      <>
        <Button variant="outline" disabled={busyAction !== null} onClick={() => { runAction('reveal') }}>
          {t('dialog.openFolder')}
        </Button>
        <Button variant="outline" disabled={busyAction !== null} onClick={() => { runAction('open') }}>
          {t('dialog.openFile')}
        </Button>
        <Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>
      </>
    )
    : <Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>

  return (
    <Modal
      open={open}
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
      footer={footer}
    >
      {actionError && <p role="alert">{t('dialog.actionFailed')}</p>}
    </Modal>
  )
}
