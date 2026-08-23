/** Shared interaction state for the desktop settings row and close dialog. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { DesktopCloseBehavior } from '../settings.ts'

/** Desktop close UI state. */
export interface DesktopUiState {
  /** Current durable close behavior, or the safe default while settings load. */
  behavior: DesktopCloseBehavior
  /** Durable Session log download directory ('' = platform default). */
  sessionLogDir: string
  /** Whether the Host settings provider accepts writes. */
  writable: boolean
  /** Whether the native window has one close request awaiting user input. */
  promptOpen: boolean
  /** Whether a selected action is being persisted or sent to Rust. */
  busy: boolean
  /** Whether the latest close response failed. */
  failed: boolean
  /** Monotonic settings projection revision. */
  revision: number
}

/** Store actions used by the controller and components. */
export type DesktopUiActions = {
  sync: (
    draft: DesktopUiState,
    behavior: DesktopCloseBehavior,
    sessionLogDir: string,
    writable: boolean,
    revision: number,
  ) => void
  showPrompt: (draft: DesktopUiState, failed?: boolean) => void
  setBusy: (draft: DesktopUiState, busy: boolean) => void
  dismissPrompt: (draft: DesktopUiState) => void
  fail: (draft: DesktopUiState) => void
}

/**
 * Declare the shared desktop UI store.
 * @returns the store handle shared by the settings row and close dialog.
 */
export function createDesktopUiStore(): EngineStoreHandle<DesktopUiState, DesktopUiActions> {
  return defineStore({
    init: (): DesktopUiState => ({
      behavior: 'ask', sessionLogDir: '', writable: false, promptOpen: false, busy: false, failed: false, revision: -1,
    }),
    actions: {
      sync: (draft, behavior: DesktopCloseBehavior, sessionLogDir: string, writable: boolean, revision: number) => {
        if (revision <= draft.revision) return
        draft.behavior = behavior
        draft.sessionLogDir = sessionLogDir
        draft.writable = writable
        draft.revision = revision
      },
      showPrompt: (draft, failed = false) => {
        draft.promptOpen = true
        draft.busy = false
        draft.failed = failed
      },
      setBusy: (draft, busy: boolean) => {
        draft.busy = busy
        if (busy) draft.failed = false
      },
      dismissPrompt: (draft) => {
        draft.promptOpen = false
        draft.busy = false
        draft.failed = false
      },
      fail: (draft) => {
        draft.promptOpen = true
        draft.busy = false
        draft.failed = true
      },
    },
  })
}
