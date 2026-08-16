// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { DesktopKey } from '../src/client/locales.ts'
import { en, zh } from '../src/client/locales.ts'
import { CloseBehaviorRow } from '../src/client/CloseBehaviorRow.tsx'
import type { CloseBehaviorRowProps } from '../src/client/CloseBehaviorRow.tsx'
import { CloseDialog } from '../src/client/CloseDialog.tsx'
import type { CloseDialogProps } from '../src/client/CloseDialog.tsx'
import { createDesktopUiStore } from '../src/client/store.ts'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused by desktop components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

function translator(dictionary: Record<DesktopKey, string>): CloseDialogProps['t'] {
  return key => dictionary[key as DesktopKey] ?? key
}

function renderRow() {
  const store = createDesktopUiStore().create()
  store.actions.sync('ask', true, 0)
  const setBehavior = vi.fn()
  render(<CloseBehaviorRow {...({
    ...kit,
    actions: store.actions,
    useStore: bindSnapshotSelector(store),
    t: translator(zh),
    setBehavior,
  } satisfies CloseBehaviorRowProps)} />)
  return { setBehavior }
}

function renderDialog(dictionary: Record<DesktopKey, string>) {
  const store = createDesktopUiStore().create()
  store.actions.showPrompt()
  const resolveClose = vi.fn(() => Promise.resolve())
  render(<CloseDialog {...({
    ...kit,
    actions: store.actions,
    useStore: bindSnapshotSelector(store),
    t: translator(dictionary),
    resolveClose,
  } satisfies CloseDialogProps)} />)
  return { resolveClose }
}

describe('CloseBehaviorRow', () => {
  it('opens the localized settings menu and persists the selected behavior', () => {
    const { setBehavior } = renderRow()
    const trigger = screen.getByRole('button', { name: /每次询问/ })
    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: '最小化到系统托盘' }))

    expect(setBehavior).toHaveBeenCalledWith('minimize')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('CloseDialog', () => {
  it('renders the complete Chinese and English close confirmation copy', () => {
    const chinese = renderDialog(zh)
    expect(screen.getByRole('dialog', { name: '关闭 DeepSeek Harness' })).toBeTruthy()
    expect(screen.getByText('要最小化到系统托盘，还是退出应用？')).toBeTruthy()
    expect(screen.getByRole('button', { name: '最小化到托盘' })).toBeTruthy()
    chinese.resolveClose.mockClear()
    cleanup()

    renderDialog(en)
    expect(screen.getByRole('dialog', { name: 'Close DeepSeek Harness' })).toBeTruthy()
    expect(screen.getByText('Minimize to the system tray or exit the application?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Exit application' })).toBeTruthy()
  })

  it('passes the remember choice with the selected close action', () => {
    const { resolveClose } = renderDialog(zh)
    fireEvent.click(screen.getByRole('checkbox', { name: '记住我的选择' }))
    fireEvent.click(screen.getByRole('button', { name: '最小化到托盘' }))

    expect(resolveClose).toHaveBeenCalledWith('minimize', true)
  })

  it('maps Escape, mask, and the localized X button to cancel', () => {
    const { resolveClose } = renderDialog(en)

    fireEvent.keyDown(document, { key: 'Escape' })
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(mask)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(resolveClose).toHaveBeenCalledTimes(3)
    expect(resolveClose).toHaveBeenNthCalledWith(1, 'cancel', false)
    expect(resolveClose).toHaveBeenNthCalledWith(2, 'cancel', false)
    expect(resolveClose).toHaveBeenNthCalledWith(3, 'cancel', false)
  })
})
