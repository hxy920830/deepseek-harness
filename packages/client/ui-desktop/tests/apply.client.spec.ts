import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  apply as settingsApply,
  inject as settingsInject,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { DesktopSettingsSchema } from '../src/settings.ts'
import { CloseBehaviorRow } from '../src/client/CloseBehaviorRow.tsx'
import type { CloseBehaviorRowInjected } from '../src/client/CloseBehaviorRow.tsx'
import { CloseDialog } from '../src/client/CloseDialog.tsx'
import type { CloseDialogInjected } from '../src/client/CloseDialog.tsx'
import { SessionLogDirRow } from '../src/client/SessionLogDirRow.tsx'
import { createDesktopUiStore } from '../src/client/store.ts'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauri.invoke,
  isTauri: tauri.isTauri,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))

import { apply } from '../src/client/index.ts'
import { inject } from '../src/client/index.ts'

const ROW_SLOT = 'settings.general.item'
const OVERLAY_SLOT = 'shell.overlay'

beforeEach(() => {
  vi.clearAllMocks()
  tauri.isTauri.mockReturnValue(false)
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const descriptor = {
    ns: 'ui-desktop',
    schema: DesktopSettingsSchema.toJSON(),
    value: { closeBehavior: 'ask' },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  }
  new TestRemote(ctx, {
    settings: {
      describe: async () => ({
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [descriptor] },
      }),
      mutate: async () => ({ ok: true as const, value: descriptor }),
    },
  })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declareDesktopSlots(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      [ROW_SLOT]: { kind: 'list', scope: 'root' },
      [OVERLAY_SLOT]: { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-desktop client apply', () => {
  it('registers nothing outside an official Tauri WebView', () => {
    const ctx = {
      effect: vi.fn(),
      locale: { register: vi.fn() },
      settingsScope: { bind: vi.fn() },
      slots: { inject: vi.fn(), register: vi.fn() },
    }

    apply(ctx as never)

    expect(tauri.isTauri).toHaveBeenCalledOnce()
    expect(ctx.effect).not.toHaveBeenCalled()
    expect(ctx.locale.register).not.toHaveBeenCalled()
    expect(ctx.settingsScope.bind).not.toHaveBeenCalled()
    expect(ctx.slots.inject).not.toHaveBeenCalled()
    expect(ctx.slots.register).not.toHaveBeenCalled()
    expect(tauri.listen).not.toHaveBeenCalled()
    expect(tauri.invoke).not.toHaveBeenCalled()
  })

  it('assembles both desktop seats, activates listener-first, and cleans up through HMR and dispose', async () => {
    tauri.isTauri.mockReturnValue(true)
    const order: string[] = []
    const unlisten = vi.fn()
    tauri.listen.mockImplementation(async () => {
      order.push('listen')
      return unlisten
    })
    tauri.invoke.mockImplementation(async (command: string) => {
      order.push(command)
    })
    const b = await bench()
    const collapse = declareDesktopSlots(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const row = b.slots.entries(ROW_SLOT).find(entry => entry.component === CloseBehaviorRow)!
    const dirRow = b.slots.entries(ROW_SLOT).find(entry => entry.component === SessionLogDirRow)!
    const overlay = b.slots.entries(OVERLAY_SLOT).find(entry => entry.component === CloseDialog)!
    expect(row.options).toMatchObject({ id: 'desktop-close-behavior', order: 20 })
    expect(dirRow.options).toMatchObject({ id: 'desktop-session-log-dir', order: 30 })
    expect(overlay.options).toMatchObject({ id: 'desktop-close-dialog', order: 0 })
    expect(row.locale).toBe('settings.desktop')
    expect(overlay.locale).toBe('settings.desktop')
    const files = b.ctx.get('desktopSessionFiles')
    expect(files?.directory()).toBe(null)

    const handle = row.store as ReturnType<typeof createDesktopUiStore>
    expect(overlay.store).toBe(handle)
    const instance = handle.create()
    ;(row.inject as unknown as (actions: typeof instance.actions) => CloseBehaviorRowInjected)(instance.actions)
    ;(overlay.inject as unknown as (actions: typeof instance.actions) => CloseDialogInjected)(instance.actions)
    await vi.waitFor(() => { expect(tauri.invoke).toHaveBeenCalledWith('desktop_ready') })
    expect(order.slice(0, 2)).toEqual(['listen', 'desktop_ready'])
    expect(b.locale.bind('settings.desktop')('dialog.title')).toBe('关闭 DeepSeek Harness')

    collapse()
    expect(b.slots.entries(ROW_SLOT)).toEqual([])
    expect(b.slots.entries(OVERLAY_SLOT)).toEqual([])
    declareDesktopSlots(b.slots)
    await Promise.resolve()
    const recoveredRow = b.slots.entries(ROW_SLOT).find(entry => entry.component === CloseBehaviorRow)!
    const recoveredOverlay = b.slots.entries(OVERLAY_SLOT).find(entry => entry.component === CloseDialog)!
    const recovered = (recoveredRow.store as ReturnType<typeof createDesktopUiStore>).create()
    ;(recoveredRow.inject as unknown as (
      actions: typeof recovered.actions,
    ) => CloseBehaviorRowInjected)(recovered.actions)
    ;(recoveredOverlay.inject as unknown as (
      actions: typeof recovered.actions,
    ) => CloseDialogInjected)(recovered.actions)
    await Promise.resolve()
    expect(tauri.listen).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(unlisten).toHaveBeenCalledOnce()
    expect(b.slots.entries(ROW_SLOT)).toEqual([])
    expect(b.slots.entries(OVERLAY_SLOT)).toEqual([])
    expect(() => b.locale.register('settings.desktop', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.desktop', 'en', {})).not.toThrow()
  })
})
