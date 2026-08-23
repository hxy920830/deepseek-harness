/** Minimal Tauri bridge for the main-window close handshake and Session log files. */

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/** Native event emitted for one pending main-window close request. */
export const CLOSE_REQUESTED_EVENT = 'desktop://close-requested'

/** Action accepted by the native close request resolver. */
export type DesktopCloseAction = 'cancel' | 'minimize' | 'exit'

/** Payload identifying one native close request. */
export interface DesktopCloseRequest {
  requestId: number
}

/** Narrow native operations available to the desktop UI controller. */
export interface DesktopBridge {
  /** @returns whether this page is running inside a Tauri WebView. */
  available: () => boolean
  /** Subscribe before announcing readiness so an early close request cannot be lost. */
  listenCloseRequested: (listener: (request: DesktopCloseRequest) => void) => Promise<() => void>
  /** Tell Rust that the close listener is installed. */
  ready: () => Promise<void>
  /** Resolve the current native close request. */
  resolve: (requestId: number, action: DesktopCloseAction) => Promise<void>
  /**
   * Open one native folder picker.
   * @returns the picked absolute directory, or null when cancelled.
   */
  pickFolder: () => Promise<string | null>
  /**
   * Write one session archive into the configured directory without overwriting.
   * @param dir - absolute target directory validated by Rust.
   * @param filename - convention-checked `dsh-session-<id>.zip` name.
   * @param bytes - archive content as plain numbers for JSON IPC transport.
   * @returns the saved absolute path (uniquified on collision).
   */
  saveSessionLog: (dir: string, filename: string, bytes: number[]) => Promise<string>
  /**
   * Reveal one saved archive in the file manager with the file selected.
   * @param dir - absolute directory holding the archive.
   * @param filename - convention-checked archive name inside `dir`.
   */
  revealSessionLog: (dir: string, filename: string) => Promise<void>
  /**
   * Open one saved archive with its default handler.
   * @param dir - absolute directory holding the archive.
   * @param filename - convention-checked archive name inside `dir`.
   */
  openSessionLog: (dir: string, filename: string) => Promise<void>
}

/** Official Tauri API implementation restricted by the desktop capability. */
export const tauriDesktopBridge: DesktopBridge = {
  available: isTauri,
  listenCloseRequested: async listener => listen<DesktopCloseRequest>(CLOSE_REQUESTED_EVENT, (event) => {
    listener(event.payload)
  }),
  ready: async () => invoke('desktop_ready'),
  resolve: async (requestId, action) => invoke('desktop_resolve_close', { requestId, action }),
  pickFolder: async () =>
    await invoke<string | null>('desktop_pick_folder'),
  saveSessionLog: async (dir, filename, bytes) =>
    await invoke<string>('desktop_save_session_log', { dir, filename, bytes }),
  revealSessionLog: async (dir, filename) => {
    await invoke('desktop_reveal_session_log', { dir, filename })
  },
  openSessionLog: async (dir, filename) => {
    await invoke('desktop_open_session_log', { dir, filename })
  },
}
