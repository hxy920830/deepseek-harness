/** Desktop window preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Behaviors available when the user closes the main desktop window. */
export const DESKTOP_CLOSE_BEHAVIORS = ['ask', 'minimize', 'exit'] as const

/** Settings namespace owned by the desktop UI plugin. */
export const DESKTOP_SETTINGS_NAMESPACE = 'ui-desktop'

/** Field carrying the selected main-window close behavior. */
export const DESKTOP_CLOSE_BEHAVIOR_FIELD = 'closeBehavior'

/** Main-window close behavior persisted by the desktop General settings row. */
export type DesktopCloseBehavior = typeof DESKTOP_CLOSE_BEHAVIORS[number]

/** Default behavior when no user override exists. */
export const DEFAULT_DESKTOP_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'ask'

/** Durable desktop settings section shared by the Host schema and browser scope. */
export interface DesktopSettings {
  /** Action selected for the main window's close button. */
  closeBehavior: DesktopCloseBehavior
}

/** Durable desktop settings schema. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  [DESKTOP_CLOSE_BEHAVIOR_FIELD]: z.union([...DESKTOP_CLOSE_BEHAVIORS]).default(DEFAULT_DESKTOP_CLOSE_BEHAVIOR),
})
