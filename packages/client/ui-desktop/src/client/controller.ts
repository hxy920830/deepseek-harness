/** Desktop close request and durable preference controller. */

import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_DESKTOP_CLOSE_BEHAVIOR, DESKTOP_CLOSE_BEHAVIOR_FIELD,
  type DesktopCloseBehavior, type DesktopSettings,
} from '../settings.ts'
import type { DesktopBridge, DesktopCloseAction, DesktopCloseRequest } from './desktop-bridge.ts'
import type { createDesktopUiStore } from './store.ts'

type Actions = BoundActions<ReturnType<typeof createDesktopUiStore>>

/** Coordinate Host settings with the request-id-checked native close protocol. */
export class DesktopCloseController {
  private actions: Actions | undefined
  private pendingRequestId: number | undefined
  private lastRequestId = 0
  private activation: Promise<void> | undefined
  private unlisten: (() => void) | undefined
  private unsubscribe: (() => void) | undefined
  private revision = 0
  private disposed = false

  /** @param scope - durable Host settings namespace. @param bridge - restricted Tauri bridge. */
  constructor(
    private readonly scope: SettingsScope<DesktopSettings>,
    private readonly bridge: DesktopBridge,
  ) {}

  /**
   * Attach the shared store actions used by either registered component.
   * @param actions - baked actions for the shared desktop UI store.
   */
  attach(actions: Actions): void {
    this.actions = actions
    this.syncSettings()
  }

  /**
   * Install the native listener before announcing UI readiness.
   * @param actions - baked actions for the shared desktop UI store.
   */
  activate(actions: Actions): void {
    this.attach(actions)
    if (this.activation !== undefined) return
    this.unsubscribe = this.scope.subscribe(() => { this.syncSettings() })
    this.activation = this.startBridge().catch((error: unknown) => {
      if (!this.disposed) console.error('[ui-desktop] native close bridge activation failed:', error)
    })
  }

  /**
   * Persist a selection made in General settings.
   * @param behavior - close action selected by the user.
   */
  setBehavior(behavior: DesktopCloseBehavior): void {
    void this.scope.set(DESKTOP_CLOSE_BEHAVIOR_FIELD, behavior).catch((error: unknown) => {
      console.error('[ui-desktop] close preference update failed:', error)
    })
  }

  /**
   * Resolve the current prompt, persisting a non-cancel action when requested.
   * @param action - native action for the pending close request.
   * @param remember - whether to persist a non-cancel action before resolving.
   */
  async resolve(action: DesktopCloseAction, remember: boolean): Promise<void> {
    if (this.disposed) return
    const requestId = this.pendingRequestId
    if (requestId === undefined) return
    this.actions?.setBusy(true)
    try {
      if (remember && action !== 'cancel') {
        await this.scope.set(DESKTOP_CLOSE_BEHAVIOR_FIELD, action)
      }
      await this.bridge.resolve(requestId, action)
      this.pendingRequestId = undefined
      this.actions?.dismissPrompt()
    } catch {
      this.actions?.fail()
    }
  }

  /** Cancel a pending request, then release settings and native listeners. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unlisten?.()
    this.unlisten = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const requestId = this.pendingRequestId
    this.pendingRequestId = undefined
    if (requestId !== undefined) {
      try {
        await this.bridge.resolve(requestId, 'cancel')
      } catch (error) {
        console.error('[ui-desktop] pending close cancellation failed:', error)
      }
    }
    await this.activation
  }

  private async startBridge(): Promise<void> {
    this.unlisten = await this.bridge.listenCloseRequested((request) => { this.receive(request) })
    if (this.disposed) {
      this.unlisten()
      this.unlisten = undefined
      return
    }
    await this.bridge.ready()
  }

  private receive(request: DesktopCloseRequest): void {
    if (this.disposed || !Number.isSafeInteger(request.requestId) || request.requestId <= this.lastRequestId) return
    this.lastRequestId = request.requestId
    this.pendingRequestId = request.requestId
    const behavior = this.scope.getSnapshot().value?.closeBehavior ?? DEFAULT_DESKTOP_CLOSE_BEHAVIOR
    if (behavior === 'ask') {
      this.actions?.showPrompt()
      return
    }
    void this.resolve(behavior, false)
  }

  private syncSettings(): void {
    const snapshot = this.scope.getSnapshot()
    const behavior = snapshot.value?.closeBehavior ?? DEFAULT_DESKTOP_CLOSE_BEHAVIOR
    this.actions?.sync(behavior, snapshot.writable, this.revision++)
  }
}
