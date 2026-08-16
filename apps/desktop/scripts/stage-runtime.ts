/** Stage the native-platform Node carrier consumed by the packaged Tauri shell. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

const desktop = resolve(import.meta.dirname, '..')
const root = resolve(desktop, '..', '..')
const runtime = join(desktop, 'src-tauri', 'runtime')

if (!runtime.startsWith(join(desktop, 'src-tauri') + '\\') && !runtime.startsWith(join(desktop, 'src-tauri') + '/')) {
  throw new Error(`desktop runtime staging escaped apps/desktop/src-tauri: ${runtime}`)
}

function pnpmArgs(args: readonly string[]): readonly [string, readonly string[]] {
  const cli = process.env.npm_execpath
  if (cli === undefined || cli === '') {
    throw new Error('desktop runtime staging must run through pnpm so npm_execpath identifies the package-manager entry')
  }
  return [process.execPath, [cli, ...args]]
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' } })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} failed with ${code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`}`))
    })
  })
}

async function restoreDirectDependencies(staged: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const sourceNodeModules = join(desktop, 'node_modules')
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staged, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(`desktop runtime dependency ${dependency} is absent from deploy output and ${source}`)
    }
    const nestedNodeModules = join(source, 'node_modules')
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
  }
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializePackageLinks(nodeModules: string): Promise<void> {
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const source = await realpath(remaining)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(remaining, { recursive: true, force: true })
    await cp(source, remaining, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}

const [closureCommand, closureArgs] = pnpmArgs([
  'run',
  'verify-runtime-closure',
  '--manifest',
  'apps/desktop/package.json',
])
await run(closureCommand, closureArgs)
const [buildCommand, buildArgs] = pnpmArgs(['run', 'build'])
await run(buildCommand, buildArgs)
const staged = await mkdtemp(join(dirname(root), '.deepseek-harness-desktop-runtime-'))
try {
  const [deployCommand, deployArgs] = pnpmArgs([
    '--filter',
    '@deepseek-ai/dsh-desktop',
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    staged,
  ])
  await run(deployCommand, deployArgs)
  await restoreDirectDependencies(staged)
  await materializePackageLinks(join(staged, 'node_modules'))

  const deployedManifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8')) as { name?: unknown }
  if (deployedManifest.name !== '@deepseek-ai/dsh-desktop') {
    throw new Error(`desktop runtime deploy produced unexpected package ${String(deployedManifest.name)}`)
  }
  const dshRoot = join(staged, 'node_modules', '@deepseek-ai', 'dsh')
  const dshManifest = JSON.parse(await readFile(join(dshRoot, 'package.json'), 'utf8')) as {
    name?: unknown
    bin?: { dsh?: unknown }
  }
  if (dshManifest.name !== '@deepseek-ai/dsh' || dshManifest.bin?.dsh !== 'lib/bin.js') {
    throw new Error(`desktop runtime deploy produced unexpected dsh entry ${String(dshManifest.bin?.dsh)}`)
  }
  await access(join(dshRoot, dshManifest.bin.dsh))
  await access(join(staged, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'))

  await rm(runtime, { recursive: true, force: true })
  await mkdir(runtime, { recursive: true })
  await writeFile(join(runtime, '.gitignore'), '*\n!.gitignore\n')
  await rename(join(staged, 'node_modules'), join(runtime, 'node_modules'))
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  await mkdir(dirname(join(runtime, nodeName)), { recursive: true })
  await cp(process.execPath, join(runtime, nodeName))
  console.log(`desktop runtime: staged ${runtime}`)
} finally {
  try {
    await rm(staged, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } finally {
    // Legacy deploy materializes missing direct workspace dependencies beside
    // its source package. Restore the workspace links before returning so later
    // repository commands do not see a production-only install.
    const [installCommand, installArgs] = pnpmArgs(['install', '--offline', '--frozen-lockfile'])
    await run(installCommand, installArgs)
  }
}
