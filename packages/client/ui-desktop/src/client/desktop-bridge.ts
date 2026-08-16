/** Minimal Tauri bridge for the main-window close handshake. */

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
}

/** Official Tauri API implementation restricted by the desktop capability. */
export const tauriDesktopBridge: DesktopBridge = {
  available: isTauri,
  listenCloseRequested: async listener => listen<DesktopCloseRequest>(CLOSE_REQUESTED_EVENT, (event) => {
    listener(event.payload)
  }),
  ready: async () => invoke('desktop_ready'),
  resolve: async (requestId, action) => invoke('desktop_resolve_close', { requestId, action }),
}
