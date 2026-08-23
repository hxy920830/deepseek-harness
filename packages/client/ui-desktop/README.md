# @deepseek-ai/dsh-client-ui-desktop

English | [中文](README.zh.md)

Desktop-only window-close integration and Session log file operations. The Host half registers `ui-desktop.closeBehavior` with `ask` as its default and accepts `ask`, `minimize`, or `exit`, plus `ui-desktop.sessionLogDir` holding the Session log download directory (empty string = platform default); the ordinary settings provider persists both in `$DSH_HOME/settings.yaml`. The client half appears only inside the official Tauri runtime, contributes the close selector and the download-directory row to General settings, and binds them through `ctx.settingsScope`, so the durable Host document remains the single preference owner and users can change the choice after saving it.

For `ask`, the plugin renders the shared Web UI `Modal` in `shell.overlay`, using the active theme tokens and locale service. Cancel keeps the main window open; Minimize to tray hides it while the Host continues running; Exit requests the bounded desktop shutdown. Selecting Remember my choice persists Minimize or Exit before resolving the request. A stored `minimize` or `exit` resolves later close requests directly without opening the modal.

The client subscribes to `desktop://close-requested` before invoking `desktop_ready`. Each event carries a monotonically increasing `requestId`, and `desktop_resolve_close` accepts only the pending id plus `cancel`, `minimize`, or `exit`. Stale, duplicate, and future ids fail in Rust. The Tauri capability grants the loopback-hosted `main` window only event listen/unlisten and these two commands; Rust separately restricts WebView navigation to the exact origin selected at startup. Tray Exit bypasses the Web UI preference and enters the same idempotent shutdown operation directly.

The plugin also provides the optional `desktopSessionFiles` ctx service for other browser plugins: it exposes the configured directory, a no-overwrite native archive save, reveal-in-file-manager, and default-handler open. Rust validates every call against the `dsh-session-<id>.zip` name convention and an existing absolute directory, so renderer input can never address an arbitrary filesystem path. The Session export plugin consumes this service to save archives directly into the chosen folder.

## Model Experience

### Desktop close state

#### What the model sees

Nothing. The `ui-desktop.closeBehavior` preference and native request ids remain application-lifecycle state and never enter a model request.

#### Token effect

Zero tokens; this package registers no prompt section, tool schema, tool result, or user-message content.

#### KV Cache effect

No effect; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Tauri runtime only** — ordinary browser sessions receive no settings rows, overlay, event listener, or native command invocation from this plugin.
- **One pending native request** — Rust admits one close request at a time; a plugin disposal cancels that request before releasing its listeners.
- **Archive bytes cross IPC as JSON** — the native save transports archive bytes as a JSON number array; very large session exports pay encoding overhead on the way to disk.
