import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_DESKTOP_CLOSE_BEHAVIOR, DESKTOP_SETTINGS_NAMESPACE, apply,
} from '../src/index.ts'
import { DEFAULT_SESSION_LOG_DIR } from '../src/settings.ts'

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
    const ns = DESKTOP_SETTINGS_NAMESPACE as SettingsNamespace

    expect(ctx.settings.get(ns)).toEqual({
      closeBehavior: DEFAULT_DESKTOP_CLOSE_BEHAVIOR,
      sessionLogDir: DEFAULT_SESSION_LOG_DIR,
    })
    for (const closeBehavior of ['ask', 'minimize', 'exit'] as const) {
      await ctx.settings.update(ns, { closeBehavior })
      expect(ctx.settings.get(ns)).toEqual({ closeBehavior, sessionLogDir: '' })
    }
    await ctx.settings.update(ns, { closeBehavior: 'ask', sessionLogDir: 'D:\\session-logs' })
    expect(ctx.settings.get(ns)).toEqual({ closeBehavior: 'ask', sessionLogDir: 'D:\\session-logs' })
    await expect(ctx.settings.update(ns, { closeBehavior: 'later' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { sessionLogDir: 42 as never })).rejects.toThrow()
    expect(ctx.settings.get(ns)).toEqual({ closeBehavior: 'ask', sessionLogDir: 'D:\\session-logs' })

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
