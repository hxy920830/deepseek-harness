/** Desktop-only settings rows, close dialog, native request handshake, and Session log files. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from '../settings.ts'
import { CloseBehaviorRow, type CloseBehaviorRowInjected } from './CloseBehaviorRow.tsx'
import { CloseDialog, type CloseDialogInjected } from './CloseDialog.tsx'
import { DesktopCloseController } from './controller.ts'
import { tauriDesktopBridge } from './desktop-bridge.ts'
import { en, zh, type DesktopKey } from './locales.ts'
import { createDesktopSessionFiles, type DesktopSessionFiles } from './session-files.ts'
import { SessionLogDirRow, type SessionLogDirRowInjected } from './SessionLogDirRow.tsx'
import { createDesktopUiStore } from './store.ts'

export { createDesktopUiStore } from './store.ts'
export type { DesktopUiState } from './store.ts'
export type { DesktopSessionFiles } from './session-files.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop close preference and confirmation copy. */
    'settings.desktop': DesktopKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Native Session log archive operations; present only inside the Tauri
     * shell, so consumers must treat the service as optional.
     */
    desktopSessionFiles?: DesktopSessionFiles
  }
}

const SETTINGS_NS = 'settings.desktop'

/** Required services for Host settings, locale, and slot contributions. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register desktop UI only when the official Tauri runtime is present. */
export function apply(ctx: ClientContext): void {
  if (!tauriDesktopBridge.available()) return
  const scope = ctx.settingsScope.bind<DesktopSettings>({ namespace: DESKTOP_SETTINGS_NAMESPACE })
  const store = createDesktopUiStore()
  const controller = new DesktopCloseController(scope, tauriDesktopBridge)
  const files = createDesktopSessionFiles(scope, tauriDesktopBridge)
  ctx.provide('desktopSessionFiles', files)
  ctx.effect(() => () => controller.dispose(), 'ui-desktop: native close controller')
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-desktop: dictionaries')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-close-behavior',
    order: 20,
    store,
    locale: SETTINGS_NS,
    inject: (actions): CloseBehaviorRowInjected => {
      controller.attach(actions)
      return { setBehavior: (behavior) => { controller.setBehavior(behavior) } }
    },
  }, CloseBehaviorRow))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'desktop-session-log-dir',
    order: 30,
    store,
    locale: SETTINGS_NS,
    inject: (): SessionLogDirRowInjected => ({
      pick: () => { return controller.pickSessionLogDir() },
    }),
  }, SessionLogDirRow))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-close-dialog',
    order: 0,
    store,
    locale: SETTINGS_NS,
    inject: (actions): CloseDialogInjected => {
      controller.activate(actions)
      return { resolveClose: (action, remember) => controller.resolve(action, remember) }
    },
  }, CloseDialog))
}
