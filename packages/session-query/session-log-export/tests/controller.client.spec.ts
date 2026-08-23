// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DesktopSessionFiles } from '@deepseek-ai/dsh-client-ui-desktop/client'
import {
  downloadUrl, SessionLogDownloadController, sessionLogZipFilename,
} from '../src/client/controller.ts'

const SID = 'session-export-controller' as SessionId

function filesStub(overrides: Partial<DesktopSessionFiles> = {}): DesktopSessionFiles {
  return {
    directory: () => null,
    save: vi.fn(async () => 'C:\\dl\\dsh-session-x.zip'),
    reveal: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
    ...overrides,
  }
}

function okHead(): Response {
  return new Response('zip', { status: 200 })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SessionLogDownloadController', () => {
  it('downloads the host ZIP and publishes one shared success state', async () => {
    const fetcher = vi.fn(async () => okHead())
    const save = vi.fn()
    const controller = new SessionLogDownloadController(fetcher, save)

    await controller.download(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/session.export')
    expect(url.searchParams.get('sessionId')).toBe(SID)
    expect(url.searchParams.get('includeDescendants')).toBe('true')
    expect(init.method).toBe('HEAD')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(save).toHaveBeenCalledWith(
      url.toString(),
      'dsh-session-session-export-controller.zip',
    )
    expect(controller.store.getSnapshot().bySession[SID]).toEqual({
      open: true, status: 'success', error: null, filePath: null,
    })
  })

  it('collapses concurrent gestures and preserves a dismissed dialog', async () => {
    const response = Promise.withResolvers<Response>()
    const fetcher = vi.fn(() => response.promise)
    const controller = new SessionLogDownloadController(fetcher, vi.fn())

    const first = controller.download(SID)
    const second = controller.download(SID)
    expect(first).toBe(second)
    controller.dismiss(SID)
    response.resolve(okHead())
    await first

    expect(fetcher).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(false)
    controller.dismiss(SID)
  })

  it('saves natively through the configured desktop capability', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_input: string | URL, init?: RequestInit) =>
        Promise.resolve(init?.method === 'HEAD' ? okHead() : new Response('ZIPBYTES')))
      const save = vi.fn<DesktopSessionFiles['save']>(async () => 'D:\\logs\\dsh-session-demo.zip')
      const files = filesStub({
        directory: () => 'D:\\logs',
        save,
      })
      const controller = new SessionLogDownloadController(fetcher, vi.fn(), () => files)

      await controller.download(SID)

      expect(save).toHaveBeenCalledWith(
        'dsh-session-session-export-controller.zip',
        new Uint8Array(await new Response('ZIPBYTES').arrayBuffer()),
      )
      expect(controller.store.getSnapshot().bySession[SID]).toEqual({
        open: true, status: 'success', error: null, filePath: 'D:\\logs\\dsh-session-demo.zip',
      })

      vi.advanceTimersByTime(5999)
      expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(true)
      vi.advanceTimersByTime(1)
      expect(controller.store.getSnapshot().bySession[SID]).toEqual({
        open: false, status: 'success', error: null, filePath: 'D:\\logs\\dsh-session-demo.zip',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the browser download when no directory is configured', async () => {
    const fetcher = vi.fn(async () => okHead())
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const save = vi.fn<DesktopSessionFiles['save']>()
    const controller = new SessionLogDownloadController(fetcher, downloadUrl, () => filesStub({ save }))

    await controller.download(SID)

    expect(anchor).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().bySession[SID]?.filePath).toBeNull()
  })

  it('surfaces native preflight and save failures as dialog errors', async () => {
    const failingSave = filesStub({
      directory: () => 'D:\\logs',
      save: vi.fn(async () => { throw new Error('disk full') }),
    })
    const failing = new SessionLogDownloadController(async () => okHead(), vi.fn(), () => failingSave)
    await failing.download(SID)
    expect(failing.store.getSnapshot().bySession[SID]).toEqual({
      open: true, status: 'error', error: 'disk full', filePath: null,
    })

    const failingGet = filesStub({
      directory: () => 'D:\\logs',
      save: vi.fn(),
    })
    const httpGet = new SessionLogDownloadController(
      vi.fn((_input: string | URL, init?: RequestInit) =>
        Promise.resolve(init?.method === 'HEAD' ? okHead() : new Response('gone', { status: 404 }))),
      vi.fn(),
      () => failingGet,
    )
    await httpGet.download(SID)
    expect(httpGet.store.getSnapshot().bySession[SID]?.error).toBe('Export failed: HTTP 404 gone')
    expect(failingGet.save).not.toHaveBeenCalled()

    const unavailable = new SessionLogDownloadController(async () => okHead(), vi.fn())
    await unavailable.download(SID)
    expect(unavailable.store.getSnapshot().bySession[SID]?.status).toBe('success')
  })

  it('publishes HTTP and transport failures without leaking rejections', async () => {
    const http = new SessionLogDownloadController(
      async () => new Response('backend unavailable', { status: 500 }), vi.fn(),
    )
    await http.download(SID)
    expect(http.store.getSnapshot().bySession[SID]).toEqual({
      open: true,
      status: 'error',
      error: 'Export failed: HTTP 500 backend unavailable',
      filePath: null,
    })

    const transport = new SessionLogDownloadController(async () => { throw 'offline' }, vi.fn())
    await transport.download(SID)
    expect(transport.store.getSnapshot().bySession[SID]?.error).toBe('offline')

    transport.dismiss('absent' as SessionId)

    const emptyDetail = new SessionLogDownloadController(
      async () => ({
        ok: false, status: 503, text: async () => { throw new Error('body unavailable') },
      }) as unknown as Response,
      vi.fn(),
    )
    await emptyDetail.download(SID)
    expect(emptyDetail.store.getSnapshot().bySession[SID]?.error).toBe('Export failed: HTTP 503')
  })

  it('aborts active fetches on disposal and rejects later requests', async () => {
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => {
        reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
      }, { once: true })
    }))
    const controller = new SessionLogDownloadController(fetcher, vi.fn())
    const pending = controller.download(SID)

    await controller.dispose()

    await expect(pending).resolves.toBeUndefined()
    expect(signal?.aborted).toBe(true)
    await expect(controller.download(SID)).resolves.toBeUndefined()
    await controller.dispose()
  })

  it('drops the pending success auto-dismiss on disposal', async () => {
    vi.useFakeTimers()
    try {
      const controller = new SessionLogDownloadController(async () => okHead(), vi.fn())

      await controller.download(SID)
      await controller.dispose()
      vi.advanceTimersByTime(10_000)

      expect(controller.store.getSnapshot().bySession[SID]).toEqual({
        open: true, status: 'success', error: null, filePath: null,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('auto-dismisses the browser success dialog after its visible window', async () => {
    vi.useFakeTimers()
    try {
      const controller = new SessionLogDownloadController(async () => okHead(), vi.fn())

      await controller.download(SID)
      expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(true)

      vi.advanceTimersByTime(1999)
      expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(true)
      vi.advanceTimersByTime(1)
      expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a manual close during the success window closed', async () => {
    vi.useFakeTimers()
    try {
      const controller = new SessionLogDownloadController(async () => okHead(), vi.fn())

      await controller.download(SID)
      controller.dismiss(SID)
      vi.advanceTimersByTime(10_000)

      expect(controller.store.getSnapshot().bySession[SID]?.open).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a fresh gesture supersede the previous success auto-dismiss', async () => {
    vi.useFakeTimers()
    try {
      let call = 0
      const gate = Promise.withResolvers<Response>()
      const fetcher = vi.fn(() => {
        call += 1
        return call === 1 ? Promise.resolve(okHead()) : gate.promise
      })
      const controller = new SessionLogDownloadController(fetcher, vi.fn())

      await controller.download(SID)
      const restarted = controller.download(SID)
      vi.advanceTimersByTime(10_000)
      expect(controller.store.getSnapshot().bySession[SID]).toEqual({
        open: true, status: 'downloading', error: null, filePath: null,
      })

      gate.resolve(new Response('zip'))
      await restarted
      expect(controller.store.getSnapshot().bySession[SID]?.status).toBe('success')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reveals and opens only a previously saved desktop archive', async () => {
    const files = filesStub({
      directory: () => 'D:\\logs',
      reveal: vi.fn(async () => undefined),
      openFile: vi.fn(async () => undefined),
    })
    const fetcher = vi.fn((_input: string | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'HEAD' ? okHead() : new Response('b')))
    const controller = new SessionLogDownloadController(fetcher, vi.fn(), () => files)

    await expect(controller.revealSaved(SID)).rejects.toThrow('no saved Session log archive')
    await expect(controller.openSaved(SID)).rejects.toThrow('no saved Session log archive')

    await controller.download(SID)
    await controller.revealSaved(SID)
    await controller.openSaved(SID)
    expect(files.reveal).toHaveBeenCalledWith('C:\\dl\\dsh-session-x.zip')
    expect(files.openFile).toHaveBeenCalledWith('C:\\dl\\dsh-session-x.zip')

    const absent = new SessionLogDownloadController(async () => okHead(), vi.fn())
    await absent.download(SID)
    await expect(absent.revealSaved(SID)).rejects.toThrow('desktop session archives are unavailable')
  })
})

describe('browser download helpers', () => {
  it('sanitizes the archive filename and hands the URL to a download anchor', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    expect(sessionLogZipFilename('a/b' as SessionId)).toBe('dsh-session-a_b.zip')
    downloadUrl('http://host/api/session.export?sessionId=a', 'archive.zip')
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe('http://host/api/session.export?sessionId=a')
    expect(anchor.download).toBe('archive.zip')
  })
})
