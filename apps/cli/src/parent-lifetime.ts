/** Parent-owned process lifetime channel for packaged application hosts. */

import type { Readable } from 'node:stream'

/** Supported value of `DSH_PARENT_LIFETIME`. */
export const PARENT_LIFETIME_STDIO = 'stdio'

/**
 * Wait until a trusted parent writes a shutdown byte or closes its stdin pipe.
 * @param input - child-process stdin connected to the supervising parent.
 * @returns Once the parent requests shutdown or disappears.
 */
export function waitForParentStdio(input: Readable): Promise<void> {
  if (input.readableEnded || input.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      input.off('data', finish)
      input.off('end', finish)
      input.off('error', finish)
      resolve()
    }
    input.once('data', finish)
    input.once('end', finish)
    input.once('error', finish)
    input.resume()
  })
}
