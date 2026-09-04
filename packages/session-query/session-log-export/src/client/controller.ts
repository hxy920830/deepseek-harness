/** Browser download state shared by the Session Header button and `/export`. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Download phases presented by the shared modal. */
export type SessionLogDownloadStatus = 'downloading' | 'success' | 'error'

/** One Session's current download-dialog state. */
export interface SessionLogDownloadEntry {
  readonly open: boolean
  readonly status: SessionLogDownloadStatus
  readonly error: string | null
  /** Absolute archive path after a native desktop save; null on browser downloads. */
  readonly filePath: string | null
}

/** Download states keyed by the Session whose Header owns the dialog. */
export interface SessionLogDownloadState {
  bySession: Record<string, SessionLogDownloadEntry | undefined>
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>
type Save = (url: string, filename: string) => void
type DesktopFiles = () => DesktopSessionFiles | undefined

/** Native archive capability consumed structurally when the Tauri shell is present. */
export interface DesktopSessionFiles {
  /** @returns the configured download directory, or null for the browser default. */
  directory: () => string | null
  /** @param filename - archive filename. @param bytes - archive contents. @returns saved absolute path. */
  save: (filename: string, bytes: Uint8Array) => Promise<string>
  /** @param path - saved archive path. @returns completion of the reveal request. */
  reveal: (path: string) => Promise<void>
  /** @param path - saved archive path. @returns completion of the open request. */
  openFile: (path: string) => Promise<void>
}

const INITIAL: SessionLogDownloadState = { bySession: {} }

/** How long the settled browser-download success dialog stays visible before it dismisses itself. */
const SUCCESS_VISIBLE_MS = 2000

/** How long the desktop success dialog with archive actions stays visible before it dismisses itself. */
const DESKTOP_SUCCESS_VISIBLE_MS = 6000

type Timer = ReturnType<typeof setTimeout>

/**
 * Collapse an untrusted Session id into the filename convention owned by the host endpoint.
 * @param sessionId - Session whose archive is downloaded.
 * @returns one safe browser download filename.
 */
export function sessionLogZipFilename(sessionId: SessionId): string {
  return `dsh-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
}

/**
 * Hand a Host download URL to the browser download manager.
 * @param url - same-origin Host download URL.
 * @param filename - browser download filename.
 */
export function downloadUrl(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Owns one in-flight browser download per Session and publishes modal state.
 * Inside the Tauri shell with a configured directory the archive is fetched and
 * saved natively, publishing the saved path; otherwise the browser download
 * manager receives the URL. A settled success dialog dismisses itself after a
 * short visible pause; errors stay until closed.
 */
export class SessionLogDownloadController {
  /** uSES-safe state source shared by every Session-scoped modal contribution. */
  readonly store: SnapshotStore<SessionLogDownloadState> = createSnapshotStore(INITIAL)

  private readonly active = new Map<SessionId, { readonly abort: AbortController; readonly done: Promise<void> }>()
  private readonly successTimers = new Map<SessionId, Timer>()
  private disposed = false

  /**
   * @param fetcher - HTTP carrier used to read the host-streamed ZIP.
   * @param save - browser save operation.
   * @param files - resolves the native desktop archive capability, when present.
   */
  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly save: Save = downloadUrl,
    private readonly files?: DesktopFiles,
  ) {}

  /**
   * Download one Session tree; concurrent gestures for the same Session share one operation.
   * @param sessionId - root Session whose ZIP includes descendants and attachments.
   * @returns after the save starts (natively or in the browser), an error state is published, or a late post-disposal request is ignored.
   */
  download(sessionId: SessionId): Promise<void> {
    const existing = this.active.get(sessionId)
    if (existing !== undefined) return existing.done
    if (this.disposed) return Promise.resolve()
    const abort = new AbortController()
    const done = this.run(sessionId, abort.signal).finally(() => {
      this.active.delete(sessionId)
    })
    this.active.set(sessionId, { abort, done })
    return done
  }

  /**
   * Close one Session's dialog without cancelling an in-flight download.
   * Cancels that Session's pending success auto-dismiss; a manual close wins.
   * @param sessionId - Session whose modal closes.
   */
  dismiss(sessionId: SessionId): void {
    this.cancelSuccessTimer(sessionId)
    const current = this.store.getSnapshot().bySession[String(sessionId)]
    if (current === undefined || !current.open) return
    this.publish(sessionId, { ...current, open: false })
  }

  /**
   * Reveal one saved archive in the native file manager.
   * @param sessionId - Session whose saved archive is addressed.
   * @returns when the file manager launch has been handed to the OS.
   */
  async revealSaved(sessionId: SessionId): Promise<void> {
    const files = this.requireFiles()
    const path = this.savedPath(sessionId)
    await files.reveal(path)
  }

  /**
   * Open one saved archive with its default handler.
   * @param sessionId - Session whose saved archive is addressed.
   * @returns when the handler launch has been handed to the OS.
   */
  async openSaved(sessionId: SessionId): Promise<void> {
    const files = this.requireFiles()
    const path = this.savedPath(sessionId)
    await files.openFile(path)
  }

  /**
   * Abort active fetches and reach quiescence.
   * @returns after every active operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.successTimers.values()) clearTimeout(timer)
    this.successTimers.clear()
    const active = [...this.active.values()]
    for (const operation of active) operation.abort.abort()
    await Promise.allSettled(active.map(operation => operation.done))
  }

  private requireFiles(): DesktopSessionFiles {
    const files = this.files?.()
    if (files === undefined) throw new Error('desktop session archives are unavailable in this environment')
    return files
  }

  private savedPath(sessionId: SessionId): string {
    const entry = this.store.getSnapshot().bySession[String(sessionId)]
    if (entry === undefined || entry.filePath === null) {
      throw new Error('no saved Session log archive for this Session yet')
    }
    return entry.filePath
  }

  private async run(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    this.cancelSuccessTimer(sessionId)
    this.publish(sessionId, { open: true, status: 'downloading', error: null, filePath: null })
    try {
      const url = new URL('/api/session.export', hostBase())
      url.searchParams.set('sessionId', sessionId)
      url.searchParams.set('includeDescendants', 'true')
      const response = await this.fetcher(url, { method: 'HEAD', signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Export failed: HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`)
      }
      const filePath = await this.persistArchive(url, sessionId, signal)
      const open = this.store.getSnapshot().bySession[String(sessionId)]?.open ?? true
      this.publish(sessionId, { open, status: 'success', error: null, filePath })
      if (open) this.scheduleSuccessTimer(sessionId, filePath !== null ? DESKTOP_SUCCESS_VISIBLE_MS : SUCCESS_VISIBLE_MS)
    } catch (error: unknown) {
      if (signal.aborted) return
      const open = this.store.getSnapshot().bySession[String(sessionId)]?.open ?? true
      this.publish(sessionId, { open, status: 'error', error: messageOf(error), filePath: null })
    }
  }

  /**
   * Deliver the archive through the native desktop capability when configured;
   * otherwise hand the GET URL to the browser download manager.
   * @returns the saved absolute path, or null for browser downloads.
   */
  private async persistArchive(url: URL, sessionId: SessionId, signal: AbortSignal): Promise<string | null> {
    const files = this.files?.()
    if (files === undefined || files.directory() === null) {
      this.save(url.toString(), sessionLogZipFilename(sessionId))
      return null
    }
    const response = await this.fetcher(url, { method: 'GET', signal })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Export failed: HTTP ${response.status}${detail === '' ? '' : ` ${detail}`}`)
    }
    return await files.save(sessionLogZipFilename(sessionId), new Uint8Array(await response.arrayBuffer()))
  }

  private scheduleSuccessTimer(sessionId: SessionId, visibleMs: number): void {
    // Unreachable while disposed: dispose() clears every timer and an aborted
    // preflight returns before reaching the success publication.
    const timer = setTimeout(() => {
      this.successTimers.delete(sessionId)
      this.dismiss(sessionId)
    }, visibleMs)
    this.successTimers.set(sessionId, timer)
  }

  private cancelSuccessTimer(sessionId: SessionId): void {
    const timer = this.successTimers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.successTimers.delete(sessionId)
  }

  private publish(sessionId: SessionId, entry: SessionLogDownloadEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [String(sessionId)]: entry }
    })
  }
}
