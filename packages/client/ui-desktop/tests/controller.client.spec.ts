import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { DesktopSettings } from '../src/settings.ts'
import { DesktopCloseController } from '../src/client/controller.ts'
import type {
  DesktopBridge, DesktopCloseAction, DesktopCloseRequest,
} from '../src/client/desktop-bridge.ts'
import { createDesktopUiStore } from '../src/client/store.ts'

function bridgeBench() {
  let listener: ((request: DesktopCloseRequest) => void) | undefined
  const order: string[] = []
  const unlisten = vi.fn()
  const listenCloseRequested: DesktopBridge['listenCloseRequested'] = async (next) => {
    order.push('listen')
    listener = next
    return unlisten
  }
  const ready = vi.fn<DesktopBridge['ready']>(async () => { order.push('ready') })
  const resolve = vi.fn<DesktopBridge['resolve']>(
    async (_requestId: number, _action: DesktopCloseAction) => undefined,
  )
  const pickFolder = vi.fn<DesktopBridge['pickFolder']>(async () => null)
  const saveSessionLog = vi.fn<DesktopBridge['saveSessionLog']>(async () => '')
  const revealSessionLog = vi.fn<DesktopBridge['revealSessionLog']>(async () => undefined)
  const openSessionLog = vi.fn<DesktopBridge['openSessionLog']>(async () => undefined)
  const bridge: DesktopBridge = {
    available: () => true,
    listenCloseRequested,
    ready,
    resolve,
    pickFolder,
    saveSessionLog,
    revealSessionLog,
    openSessionLog,
  }
  return {
    bridge,
    order,
    unlisten,
    pickFolder,
    emit: (request: DesktopCloseRequest) => {
      if (listener === undefined) throw new Error('close listener is not installed')
      listener(request)
    },
  }
}

function controllerBench(
  closeBehavior: DesktopSettings['closeBehavior'] = 'ask',
  sessionLogDir: string = '',
) {
  const host = stubSettingsScope<DesktopSettings>()
  host.publish({
    status: 'ready', value: { closeBehavior, sessionLogDir }, revision: 1, writable: true,
  })
  const native = bridgeBench()
  const store = createDesktopUiStore().create()
  const controller = new DesktopCloseController(host.scope, native.bridge)
  controller.activate(store.actions)
  return { controller, host, native, store }
}

describe('DesktopCloseController', () => {
  it('installs the close listener before announcing UI readiness', async () => {
    const b = controllerBench()
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    expect(b.native.order).toEqual(['listen', 'ready'])
    expect(b.host.listenerCount()).toBe(1)
    await b.controller.dispose()
  })

  it('opens the confirmation prompt for ask and ignores malformed request ids', async () => {
    const b = controllerBench('ask')
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    for (const requestId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      b.native.emit({ requestId })
    }
    expect(b.store.getSnapshot().promptOpen).toBe(false)
    expect(b.native.bridge.resolve).not.toHaveBeenCalled()

    b.native.emit({ requestId: 7 })
    expect(b.store.getSnapshot()).toMatchObject({ promptOpen: true, busy: false, failed: false })
    await b.controller.resolve('cancel', false)
    expect(b.native.bridge.resolve).toHaveBeenCalledWith(7, 'cancel')
    expect(b.store.getSnapshot().promptOpen).toBe(false)
    await b.controller.dispose()
  })

  it.each([
    ['minimize', 'minimize'],
    ['exit', 'exit'],
  ] as const)('resolves %s without opening the prompt', async (closeBehavior, action) => {
    const b = controllerBench(closeBehavior)
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    b.native.emit({ requestId: 8 })
    await vi.waitFor(() => { expect(b.native.bridge.resolve).toHaveBeenCalledWith(8, action) })
    expect(b.store.getSnapshot().promptOpen).toBe(false)
    expect(b.host.set).not.toHaveBeenCalled()
    await b.controller.dispose()
  })

  it('persists a remembered prompt action before resolving the native request', async () => {
    const b = controllerBench('ask')
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    const order: string[] = []
    let finishPersist!: () => void
    const persisted = new Promise<void>((resolve) => { finishPersist = resolve })
    b.host.set.mockReturnValue(persisted)
    vi.mocked(b.native.bridge.resolve).mockImplementation(async () => { order.push('resolve') })
    b.native.emit({ requestId: 9 })

    const resolving = b.controller.resolve('minimize', true)
    expect(b.native.bridge.resolve).not.toHaveBeenCalled()
    order.push('persist')
    finishPersist()
    await resolving

    expect(b.host.set).toHaveBeenCalledWith('closeBehavior', 'minimize')
    expect(b.native.bridge.resolve).toHaveBeenCalledWith(9, 'minimize')
    expect(order).toEqual(['persist', 'resolve'])
    expect(b.store.getSnapshot().promptOpen).toBe(false)
    await b.controller.dispose()
  })

  it('keeps the newest request when an older or duplicate event arrives later', async () => {
    const b = controllerBench('ask')
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    b.native.emit({ requestId: 11 })
    b.native.emit({ requestId: 10 })
    b.native.emit({ requestId: 11 })

    await b.controller.resolve('exit', false)

    expect(b.native.bridge.resolve).toHaveBeenCalledOnce()
    expect(b.native.bridge.resolve).toHaveBeenCalledWith(11, 'exit')
    await b.controller.dispose()
  })

  it('cancels a pending prompt and releases both subscriptions on dispose', async () => {
    const b = controllerBench('ask')
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    b.native.emit({ requestId: 12 })

    await b.controller.dispose()

    expect(b.native.bridge.resolve).toHaveBeenCalledWith(12, 'cancel')
    expect(b.native.unlisten).toHaveBeenCalledOnce()
    expect(b.host.listenerCount()).toBe(0)
  })

  it('projects the durable session log directory into the shared store', async () => {
    const b = controllerBench('ask', 'D:\\session-logs')
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })

    expect(b.store.getSnapshot().sessionLogDir).toBe('D:\\session-logs')
    await b.controller.dispose()
  })

  it('persists a picked download directory and ignores a cancelled picker', async () => {
    const b = controllerBench()
    await vi.waitFor(() => { expect(b.native.bridge.ready).toHaveBeenCalledOnce() })
    b.native.pickFolder.mockResolvedValueOnce(null)

    await b.controller.pickSessionLogDir()
    expect(b.host.set).not.toHaveBeenCalled()

    b.native.pickFolder.mockResolvedValueOnce('E:\\downloads')
    await b.controller.pickSessionLogDir()

    expect(b.host.set).toHaveBeenCalledWith('sessionLogDir', 'E:\\downloads')
    await b.controller.dispose()
  })
})
