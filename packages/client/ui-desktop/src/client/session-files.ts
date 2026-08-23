/** Session log archive operations published on ctx for other browser plugins. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopSettings } from '../settings.ts'
import { DESKTOP_SESSION_LOG_DIR_FIELD } from '../settings.ts'
import type { DesktopBridge } from './desktop-bridge.ts'

/** Archive names the native commands accept, mirrored from Rust validation. */
const SESSION_LOG_ARCHIVE_PATTERN = /^dsh-session-[A-Za-z0-9_-]+\.zip$/

/**
 * Native Session log archive capability consumed by the Session export plugin.
 * Present only when the Tauri shell booted this page.
 */
export interface DesktopSessionFiles {
  /** @returns the configured download directory, or null when unset (platform default). */
  directory: () => string | null
  /**
   * Write one archive into the configured directory without overwriting.
   * @param filename - convention-checked `dsh-session-<id>.zip` name.
   * @param bytes - archive content.
   * @returns the saved absolute path (uniquified on collision).
   */
  save: (filename: string, bytes: Uint8Array) => Promise<string>
  /** Reveal one saved archive in the file manager with the file selected. */
  reveal: (path: string) => Promise<void>
  /** Open one saved archive with its default handler. */
  openFile: (path: string) => Promise<void>
}

/**
 * Split one saved absolute path back into the (dir, filename) pair the native
 * commands validate. Rejects anything outside the archive convention so a
 * stale or forged path cannot reach the filesystem layer.
 * @param path - absolute path previously returned by {@link save}.
 * @returns the native command arguments.
 */
export function splitSessionLogPath(path: string): { dir: string; filename: string } {
  const separator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  const dir = separator > 0 ? path.slice(0, separator) : ''
  const filename = separator >= 0 ? path.slice(separator + 1) : path
  if (dir === '' || !SESSION_LOG_ARCHIVE_PATTERN.test(filename)) {
    throw new Error(`not a saved Session log archive path: ${path}`)
  }
  return { dir, filename }
}

/**
 * Bind the Session log archive capability to durable settings and the bridge.
 * @param scope - durable Host settings namespace carrying the directory choice.
 * @param bridge - restricted Tauri bridge.
 * @returns the ctx service consumed by the Session export plugin.
 */
export function createDesktopSessionFiles(scope: SettingsScope<DesktopSettings>, bridge: DesktopBridge): DesktopSessionFiles {
  return {
    directory: () => scope.getSnapshot().value?.[DESKTOP_SESSION_LOG_DIR_FIELD] || null,
    async save(filename, bytes) {
      const dir = scope.getSnapshot().value?.[DESKTOP_SESSION_LOG_DIR_FIELD] ?? ''
      if (dir === '') throw new Error('no Session log download directory configured')
      return await bridge.saveSessionLog(dir, filename, Array.from(bytes))
    },
    async reveal(path) {
      const { dir, filename } = splitSessionLogPath(path)
      await bridge.revealSessionLog(dir, filename)
    },
    async openFile(path) {
      const { dir, filename } = splitSessionLogPath(path)
      await bridge.openSessionLog(dir, filename)
    },
  }
}
