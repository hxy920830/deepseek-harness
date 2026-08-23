/** Desktop window preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Behaviors available when the user closes the main desktop window. */
export const DESKTOP_CLOSE_BEHAVIORS = ['ask', 'minimize', 'exit'] as const

/** Settings namespace owned by the desktop UI plugin. */
export const DESKTOP_SETTINGS_NAMESPACE = 'ui-desktop'

/** Field carrying the selected main-window close behavior. */
export const DESKTOP_CLOSE_BEHAVIOR_FIELD = 'closeBehavior'

/** Field carrying the Session log download directory ('' = platform default). */
export const DESKTOP_SESSION_LOG_DIR_FIELD = 'sessionLogDir'

/** Main-window close behavior persisted by the desktop General settings row. */
export type DesktopCloseBehavior = typeof DESKTOP_CLOSE_BEHAVIORS[number]

/** Default behavior when no user override exists. */
export const DEFAULT_DESKTOP_CLOSE_BEHAVIOR: DesktopCloseBehavior = 'ask'

/** Durable desktop settings section shared by the Host schema and browser scope. */
export interface DesktopSettings {
  /** Action selected for the main window's close button. */
  closeBehavior: DesktopCloseBehavior
  /** Absolute directory receiving Session log archives; empty uses the platform default. */
  sessionLogDir: string
}

/** Default download directory resolution when no user override exists. */
export const DEFAULT_SESSION_LOG_DIR = ''

/** Durable desktop settings schema. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  [DESKTOP_CLOSE_BEHAVIOR_FIELD]: z.union([...DESKTOP_CLOSE_BEHAVIORS]).default(DEFAULT_DESKTOP_CLOSE_BEHAVIOR),
  [DESKTOP_SESSION_LOG_DIR_FIELD]: z.string().default(DEFAULT_SESSION_LOG_DIR),
})
