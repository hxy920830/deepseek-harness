/** Host registration for durable desktop window preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DESKTOP_SETTINGS_NAMESPACE, DesktopSettingsSchema } from './settings.ts'

export {
  DEFAULT_DESKTOP_CLOSE_BEHAVIOR, DESKTOP_CLOSE_BEHAVIOR_FIELD, DESKTOP_CLOSE_BEHAVIORS,
  DESKTOP_SETTINGS_NAMESPACE, type DesktopCloseBehavior, type DesktopSettings,
} from './settings.ts'

const DESKTOP_NAMESPACE = DESKTOP_SETTINGS_NAMESPACE as SettingsNamespace

/** Register the durable desktop settings section when settings are composed. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(DESKTOP_NAMESPACE, DesktopSettingsSchema)
  })
}
