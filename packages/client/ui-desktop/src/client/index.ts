/** Desktop-only settings row, close dialog, and native request handshake. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from '../settings.ts'
import { CloseBehaviorRow, type CloseBehaviorRowInjected } from './CloseBehaviorRow.tsx'
import { CloseDialog, type CloseDialogInjected } from './CloseDialog.tsx'
import { DesktopCloseController } from './controller.ts'
import { tauriDesktopBridge } from './desktop-bridge.ts'
import { en, zh, type DesktopKey } from './locales.ts'
import { createDesktopUiStore } from './store.ts'

export { createDesktopUiStore } from './store.ts'
export type { DesktopUiState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop close preference and confirmation copy. */
    'settings.desktop': DesktopKey
  }
}

const SETTINGS_NS = 'settings.desktop'

/** Required services for Host settings, locale, and slot contributions. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Register desktop UI only when the official Tauri runtime is present. */
export function apply(ctx: ClientContext): void {
  if (!tauriDesktopBridge.available()) return
  const scope = ctx.settingsScope.bind<DesktopSettings>({ namespace: DESKTOP_SETTINGS_NAMESPACE })
  const store = createDesktopUiStore()
  const controller = new DesktopCloseController(scope, tauriDesktopBridge)
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
