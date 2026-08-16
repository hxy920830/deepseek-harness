# DeepSeek Harness Desktop

English | [中文](README.zh.md)

The Tauri 2 desktop application owns the native window, tray, restricted close handshake, and child-process lifecycle. It starts the existing `dsh web` composition on an OS-assigned loopback port, waits for its `dsh web:` readiness line, and loads that URL in the main WebView. The Web Host still injects `window.__DSH_BOOT__`, serves client plugin bundles, and carries API traffic over same-origin HTTP and WebSocket; the shell does not copy the plugin roster.

## Development

From the repository root:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

The Tauri development hook builds the repository first. The Rust process then launches `pnpm dsh web --host 127.0.0.1 --port 0` from the checkout and keeps its stdin pipe open as the parent-lifetime channel.

## Window and tray lifecycle

Closing the main window starts a request-id-checked handshake with [`@deepseek-ai/dsh-client-ui-desktop`](../../packages/client/ui-desktop/README.md). The `ui-desktop.closeBehavior` Host setting defaults to `ask`, and General settings can change it to `minimize` or `exit`; the local settings provider persists the value in `$DSH_HOME/settings.yaml`. The `ask` path opens the shared Web UI `Modal`, so its colors, controls, and copy follow the active application theme and locale. The modal offers **Minimize to tray**, **Exit**, and **Cancel**, plus **Remember my choice** for either non-cancel action.

Minimizing hides the window while the Harness Host remains active; Cancel and the modal close affordances leave the main window open. A left click on the DeepSeek tray icon or **Show DeepSeek Harness** restores, unminimizes, and focuses the window. Tray **Exit** bypasses the saved close preference and uses the same bounded Host shutdown path directly.

The main loopback WebView can only listen and unlisten for the close event and invoke `desktop_ready` and `desktop_resolve_close`. Rust accepts a resolution only for the current pending request id, restricts navigation to the exact origin selected at startup, and exposes no general Tauri core or plugin capability to the page.

The shell writes to the Host stdin before exit. The CLI disposes the complete Cordis tree and settles its existing five-second shutdown controller; stdin EOF requests the same shutdown if the desktop parent disappears. The Rust owner waits five seconds and force-terminates only a Host that does not settle.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
```

The build hook runs [`scripts/stage-runtime.ts`](scripts/stage-runtime.ts): it verifies the private `apps/desktop-runtime` deploy manifest's workspace-peer closure, builds the repository, materializes the production dependency tree into Tauri resources, and copies the current native Node executable beside that tree. The installed application therefore uses its bundled Node carrier and built Web/plugin artifacts instead of a system `node`, `pnpm`, or `dsh` command. Build each installer on its target operating system and architecture so Node, native addons, WebView metadata, and signatures match the target.

The icon files under `src-tauri/icons/` are generated from [`apps/web/public/favicon.svg`](../web/public/favicon.svg), which remains the single editable DeepSeek icon source.

## Known limitations

- The first desktop release uses the existing loopback HTTP/WebSocket carrier. Replacing it with native IPC requires a complete carrier for the dynamic boot manifest, client plugin bundles, unary calls, both downlink streams, and responses.
