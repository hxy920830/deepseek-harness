import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { waitForParentStdio } from '../src/parent-lifetime.ts'

describe('parent stdio lifetime', () => {
  it('settles when the parent writes a shutdown request', async () => {
    const input = new PassThrough()
    const settled = vi.fn()
    const waiting = waitForParentStdio(input).then(settled)

    input.write('shutdown\n')
    await waiting

    expect(settled).toHaveBeenCalledOnce()
    expect(input.listenerCount('data')).toBe(0)
    expect(input.listenerCount('end')).toBe(0)
  })

  it('settles when the parent closes the pipe', async () => {
    const input = new PassThrough()
    const waiting = waitForParentStdio(input)

    input.end()

    await expect(waiting).resolves.toBeUndefined()
  })

  it('settles immediately for an already closed pipe', async () => {
    const input = new PassThrough()
    input.destroy()

    await expect(waitForParentStdio(input)).resolves.toBeUndefined()
  })
})
