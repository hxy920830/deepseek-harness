# Agent Note: 基于 Web Host 的 Tauri 桌面壳

Status: implemented

[English](2026-08-16-tauri-desktop-shell.md) | 中文

## 问题

DeepSeek Harness 需要一个带系统托盘和明确关闭行为的 Tauri 2 桌面应用。现有浏览器应用不是独立静态 bundle：`dsh web` 会注入启动清单，提供运行时选定的客户端插件，并提供 HTTP/WebSocket API。桌面安装包也不能假设目标机器已经安装 Node、pnpm 或 dsh。

## 决策

[`apps/desktop`](../../../../apps/desktop/README.zh.md) 是位于现有 Web 组合之上的应用壳。Rust 负责原生窗口、系统托盘、受限关闭握手和一个子 Host。它使用回环地址与零端口启动 `dsh web`，只接受既有的 `dsh web: http://127.0.0.1:<port>` 就绪信号，并在收到信号后创建主 WebView。

开发态启动仓库中的 `pnpm dsh` 入口。生产态通过私有 `apps/desktop-runtime` deploy root 验证并物化已构建 Web 组合的 workspace peer 闭包，再将该依赖树与构建机器的原生 Node 可执行文件暂存为 Tauri resources。每个平台分别构建自己的载体和安装包。

桌面进程保持 Host stdin 开启，将其作为显式父进程生命周期通道。收到字节或 EOF 后，CLI 会运行既有的有界关闭控制器，dispose Cordis 树。桌面退出会等待该子进程完成；五秒后仍未完成才会强制终止。

[`@deepseek-ai/dsh-client-ui-desktop`](../../../../packages/client/ui-desktop/README.zh.md) 注册持久 Host 字段 `ui-desktop.closeBehavior`，其封闭取值为 `ask`、`minimize` 和 `exit`，默认值为 `ask`。其 Tauri 专用客户端贡献会把选择器放入通用设置，并通过共享 Web UI Modal、主题 token 和 locale 服务渲染 `ask` 确认框。记住非取消响应时，插件会在解析原生请求之前写入同一 Host 设置，因此 Rust 或浏览器本地存储中没有偏好设置副本。

Rust 每次接纳一个关闭请求，并为其分配单调递增的 id。客户端先安装事件监听器，再调用 `desktop_ready`；Rust 会保留就绪前到达的请求，并且只接受当前 id 的 `desktop_resolve_close`。桌面 capability 只向回环地址承载的 `main` 窗口授予事件监听／取消监听和这两个命令，而 `on_navigation` 会将 WebView 限制在启动时选定的准确 origin。最小化只隐藏主窗口，不影响 Host；取消会保持窗口开启；确认框中的退出与托盘退出汇入同一个幂等关闭操作，且托盘退出不会查询已保存的偏好设置，直接进入该操作。

`apps/web/public/favicon.svg` 中的 DeepSeek SVG 是可编辑图标源。Tauri 生成的 PNG、ICO 和 ICNS 文件是为原生构建检入的派生产物。

## 曾考虑的替代方案

**让 Tauri 直接加载 `apps/web/dist`。** 否决，因为该静态文件没有 `window.__DSH_BOOT__`、动态客户端插件路由或同源 API。在 Rust 中重建这些值会复制 Web 组合，并与 profile patch 发生漂移。

**立即新增原生 IPC carrier。** 当前功能不采用此方案，因为完整 carrier 必须支持启动清单与插件 bundle 交付、单次请求、两条服务端到客户端流，以及客户端响应。托盘和关闭生命周期不需要这套新协议实现；回环方案保留既有信任围栏和组装应用行为。

**要求系统安装 dsh 或 Node。** 否决，因为安装后的桌面客户端必须持有自己的运行时。按原生平台打包的 resource 树保留标准 Node 包解析，并使用与 CLI 相同的已构建包。

**复用 Python SDK 可执行文件。** 否决，因为该产物暴露 JSON-RPC SDK 应用，携带不同配置，且不以 Windows 为目标。桌面分发单独持有 Web Host 载体。

## 后果

桌面应用复用真实 Web Host、profile 层、客户端插件名录、主题、locale 和设置持久化。一个客户端插件依赖受限的 Tauri JavaScript API，但原生窗口权限与请求校验仍由 Rust 负责。首个版本仍会打开临时回环监听端口，安装体积也包含 Node 和已部署的 Harness 依赖树。原生安装包验证必须在各目标平台分别运行；后续若出现零端口要求，再实现上述完整 IPC carrier。
