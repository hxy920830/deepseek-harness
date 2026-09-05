# Agent Note: Tauri desktop shell over the Web Host

Status: implemented

English | [中文](2026-08-16-tauri-desktop-shell.zh.md)

## Problem

DeepSeek Harness needs a Tauri 2 desktop application with a system tray and explicit close behavior. The existing browser application is not a standalone static bundle: `dsh web` injects its boot manifest, serves the runtime-selected client plugins, and provides the HTTP/WebSocket API. A desktop installer also cannot assume that Node, pnpm, or dsh is installed on the target machine.

## Decision

[`apps/desktop`](../../../../apps/desktop/README.md) is an application shell above the existing Web composition. Rust owns the native window, tray, restricted close handshake, and one child Host. It starts `dsh web` on loopback with port zero, accepts only the existing `dsh web: http://127.0.0.1:<port>` readiness signal, and creates the main WebView after that signal.

Development starts the source CLI directly from the repository root with `node --import tsx/esm apps/cli/src/bin.ts web --host 127.0.0.1 --port 0 --no-open`, so the Tauri WebView owns the loopback page without a `pnpm.cmd` wrapper or system-browser handoff. The desktop package declares the built Web composition's complete production dependency set; production verifies its workspace-peer closure, deploys that dependency tree, and stages it with the build machine's native Node executable as Tauri resources. Each platform builds its own carrier and installer.

The desktop process keeps Host stdin open as an explicit parent-lifetime channel. A byte or EOF asks the CLI to run its existing bounded shutdown controller, which disposes the Cordis tree. Desktop exit waits for that child to settle and force-terminates it after five seconds.

[`@deepseek-ai/dsh-client-ui-desktop`](../../../../packages/client/ui-desktop/README.md) registers the durable Host field `ui-desktop.closeBehavior` with `ask`, `minimize`, and `exit` as its closed values and `ask` as the default. Its Tauri-only client contribution places the selector in General settings and renders the `ask` confirmation through the shared Web UI modal, theme tokens, and locale service. Remembering a non-cancel response writes the same Host setting before resolving the native request, so no preference copy exists in Rust or browser-local storage.

Rust admits one close request at a time and assigns each a monotonically increasing id. The client installs its event listener before `desktop_ready`; Rust retains an early request until readiness and accepts `desktop_resolve_close` only for the current id. The desktop capability grants only event listen/unlisten and these two commands to the loopback-hosted `main` window, while `on_navigation` restricts the WebView to the exact origin selected at startup. Minimizing hides the main window without touching the Host, Cancel keeps it open, and confirmation exit plus tray exit converge on one idempotent shutdown operation; tray exit enters that operation directly without consulting the saved preference.

The DeepSeek SVG at `apps/web/public/favicon.svg` is the editable icon source. Tauri's generated PNG, ICO, and ICNS files are derived artifacts checked in for native builds.

## Alternatives considered

**Load `apps/web/dist` directly in Tauri.** Rejected because the static file has no `window.__DSH_BOOT__`, dynamic client plugin routes, or same-origin API. Recreating those values in Rust would duplicate the Web composition and drift from profile patches.

**Add a native IPC carrier now.** Rejected for this feature because a complete carrier must support boot-manifest and plugin-bundle delivery, unary requests, two server-to-client streams, and client responses. Tray and close lifecycle do not require that new protocol implementation; loopback preserves the existing trust fence and assembled application behavior.

**Require a system dsh or Node installation.** Rejected because an installed desktop client must own its runtime. The native-platform resource tree retains standard Node package resolution and the same built packages used by the CLI.

**Reuse the Python SDK executable.** Rejected because that artifact exposes the JSON-RPC SDK application, carries a different configuration, and does not target Windows. Desktop distribution owns a separate Web Host carrier.

## Consequences

The desktop app reuses the real Web Host, profile layers, client plugin roster, theme, locale, and settings persistence. One client plugin depends on the restricted Tauri JavaScript API, but native window authority and request validation remain in Rust. The initial release still opens an ephemeral loopback listener, and its installed size includes Node plus the deployed Harness dependency tree. Native installer verification must run per target platform, and a later zero-port requirement would justify the complete IPC carrier described above.
