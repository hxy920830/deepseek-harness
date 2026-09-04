---
description: "Tauri desktop close behavior and native Session-log archive operations for users and maintainers composing the dsh web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-desktop` lets the official Tauri desktop window ask, minimize, or exit when the user closes it, and lets the Session export flow save archives into a selected local directory. General settings persist the close behavior and Session-log directory in the Host settings document. The client adds no UI in ordinary browsers, while the desktop client uses the shared locale, theme, settings, and slot services. Native commands validate request ids, archive names, and target directories before changing the window or filesystem.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the desktop Web composition when the page runs inside the official Tauri WebView. The General settings page then exposes the close behavior selector and Session-log directory picker; the Session export package can use the published `desktopSessionFiles` capability for native archive saves.

### When to choose it

Choose this package for a local Tauri desktop shell with a Host on the same machine. Browser-only deployments receive no desktop rows or native commands, and remote browser deployments should keep Session export on the browser download path.

### Composition

```yaml
- id: desktop-ui
  name: '@deepseek-ai/dsh-client-ui-desktop'
```

The composition must provide the locale, layout, settings, settings-general, and slot services declared by the package's client metadata.

### Configuration

This plugin has no Cordis configuration fields. Users configure `closeBehavior` and `sessionLogDir` through General settings; an empty `sessionLogDir` leaves archive destination selection to the browser or platform default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half registers one durable `ui-desktop` settings namespace. The browser half exits early unless Tauri is available, binds that namespace through `ctx.settingsScope`, and registers two General-setting rows plus one close-dialog overlay through declared slots.

### Desktop close flow

The controller listens for `desktop://close-requested` before calling `desktop_ready`. It ignores non-increasing request ids, resolves stored `minimize` or `exit` choices directly, and gives `ask` requests to the shared modal. Remembered choices are written through the settings scope before the native request is resolved; disposal cancels one pending request and removes the listener.

### Session-log file capability

When a directory is configured, `desktopSessionFiles.save` sends archive bytes and the convention-checked `dsh-session-<id>.zip` name to Rust. The capability also exposes reveal and default-handler open operations by splitting only paths returned from its own save operation. The export package can consume the optional service without importing Tauri APIs.

### Native boundary

The Tauri capability grants the loopback-hosted main window only the close, folder-picker, archive-save, reveal, and open commands plus the close event listener. Rust applies the request-id, action, archive-name, absolute-directory, and WebView-origin checks before performing native work.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the desktop package is not enough. They cover the settings provider, the Session export consumer, and the surrounding browser composition.

- [ui-settings](../ui-settings/README.md) — owns the browser settings scope and shared settings mirror.
- [ui-settings-general](../ui-settings-general/README.md) — hosts the General settings page and its item slot.
- [session-log-export](../../session-query/session-log-export/README.md) — consumes native Session-log file operations when available.
- [Tauri desktop shell](../../../apps/desktop/README.md) — owns the native window, command, and capability configuration.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package manages desktop lifecycle and file operations without registering model-facing content.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the native desktop operations are available and how large archive transfers behave.

- **Official Tauri runtime only** — ordinary browser sessions receive no desktop settings rows, close overlay, native event listener, or native command calls.
- **One pending close request** — the Rust handler accepts one close request at a time, and disposal cancels that request before releasing the browser listener.
- **Archive bytes cross IPC as JSON** — native archive saves transport bytes as a JSON number array, so large Session exports pay encoding and transfer overhead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime checks:** No invariant companion is published because the settings schema owns durable value validity, while the native command handler owns close-request authorization and state; neither exposes an independently observable relationship for a package-owned invariant.
