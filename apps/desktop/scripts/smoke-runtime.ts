/** Exercise the staged desktop runtime through its packaged entry point. */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'

const desktop = resolve(import.meta.dirname, '..')
const runtime = join(desktop, 'src-tauri', 'runtime')
const node = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node')
const entry = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const child = spawn(node, [entry, 'web', '--host', '127.0.0.1', '--port', '0'], {
  cwd: runtime,
  env: { ...process.env, DSH_PARENT_LIFETIME: 'stdio' },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk: string) => {
  stderr += chunk
})

const lines = createInterface({ input: child.stdout })
function waitForReadiness(): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('staged runtime did not become ready within 30 seconds')), 30_000)
    const fail = (error: Error): void => {
      clearTimeout(timeout)
      reject(error)
    }
    child.once('error', fail)
    child.once('exit', (code, signal) => {
      fail(new Error(`staged runtime exited before readiness (${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`})\n${stderr}`))
    })
    lines.on('line', (line) => {
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/u.exec(line)
      if (match?.[1] === undefined) return
      clearTimeout(timeout)
      resolvePromise(match[1])
    })
  })
}

function waitForExit(): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise<number | null>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('staged runtime did not stop within 10 seconds')), 10_000)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolvePromise(code)
    })
  })
}

try {
  const readyUrl = await waitForReadiness()
  const response = await fetch(readyUrl)
  const html = await response.text()
  if (!response.ok) throw new Error(`staged runtime returned HTTP ${String(response.status)}`)
  if (!html.includes('window.__DSH_BOOT__')) {
    throw new Error('staged runtime page does not contain the dynamic boot manifest')
  }
  console.log(`desktop runtime smoke: HTTP ${String(response.status)}, dynamic boot manifest present`)

  child.stdin.end('shutdown\n')
  const exitCode = await waitForExit()
  if (exitCode !== 0) throw new Error(`staged runtime exited with ${String(exitCode)}\n${stderr}`)
  console.log('desktop runtime smoke: stdin shutdown exited cleanly')
} finally {
  lines.close()
  if (child.exitCode === null) child.kill()
}
