import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_DESKTOP_CLOSE_BEHAVIOR, DESKTOP_SETTINGS_NAMESPACE, apply,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true

  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }

  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-desktop host', () => {
  it('registers, defaults, validates, and disposes the durable close behavior', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(DESKTOP_SETTINGS_NAMESPACE)

    expect(ctx.settings.get(ns)).toEqual({ closeBehavior: DEFAULT_DESKTOP_CLOSE_BEHAVIOR })
    for (const closeBehavior of ['ask', 'minimize', 'exit'] as const) {
      await ctx.settings.update(ns, { closeBehavior })
      expect(ctx.settings.get(ns)).toEqual({ closeBehavior })
    }
    await expect(ctx.settings.update(ns, { closeBehavior: 'later' })).rejects.toThrow()
    expect(ctx.settings.get(ns)).toEqual({ closeBehavior: 'exit' })

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
