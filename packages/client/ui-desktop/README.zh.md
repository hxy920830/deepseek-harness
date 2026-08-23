# @deepseek-ai/dsh-client-ui-desktop

[English](README.md) | 中文

仅用于桌面端的窗口关闭集成与 Session 日志文件操作。Host 侧注册 `ui-desktop.closeBehavior`，默认值为 `ask`，可取 `ask`、`minimize` 或 `exit`，并注册 `ui-desktop.sessionLogDir` 保存 Session log 下载目录（空字符串表示平台默认）；常规设置提供方会将两者持久化到 `$DSH_HOME/settings.yaml`。客户端侧只在官方 Tauri 运行时中呈现，把关闭选择器和下载目录行贡献到通用设置，并通过 `ctx.settingsScope` 绑定，使 Host 持久文档继续作为该偏好设置的单一所有者，用户保存后仍可修改选择。

对于 `ask`，插件在 `shell.overlay` 中渲染共享 Web UI `Modal`，并使用当前主题 token 和 locale 服务。取消会保持主窗口开启；最小化到托盘会隐藏窗口，同时 Host 继续运行；退出会请求有界的桌面端关闭流程。选中“记住我的选择”后，插件会先持久化“最小化”或“退出”，再解析请求。保存为 `minimize` 或 `exit` 后，后续关闭请求会直接解析，不再打开 Modal。

客户端先订阅 `desktop://close-requested`，再调用 `desktop_ready`。每个事件携带单调递增的 `requestId`，`desktop_resolve_close` 只接受当前待处理 id 以及 `cancel`、`minimize` 或 `exit`。Rust 会拒绝陈旧、重复和未来 id。Tauri capability 只向回环地址承载的 `main` 窗口授予事件监听／取消监听和这两个命令；Rust 还会把 WebView 导航限制为启动时选定的准确 origin。托盘中的退出会绕过 Web UI 偏好设置，直接进入同一个幂等关闭操作。

插件还向其他浏览器插件提供可选的 `desktopSessionFiles` ctx 服务：暴露配置的下载目录、不覆盖的原生归档写入、文件管理器定位和默认程序打开。Rust 会按 `dsh-session-<id>.zip` 名称约定和已存在的绝对目录校验每次调用，因此渲染进程输入永远无法指向任意文件系统路径。Session 导出插件消费该服务，把归档直接保存到所选文件夹。

## 模型体验

### 桌面关闭状态

#### 模型看到的内容

无。`ui-desktop.closeBehavior` 偏好设置与原生请求 id 始终属于应用生命周期状态，不会进入模型请求。

#### Token 影响

零 token；该包不注册提示词段落、工具 schema、工具结果或用户消息内容。

#### KV Cache 影响

无影响；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅限 Tauri 运行时**：普通浏览器会话不会从该插件获得设置行、overlay、事件监听器或原生命令调用。
- **仅一个待处理原生请求**：Rust 每次只接纳一个关闭请求；插件 dispose 时会先取消该请求，再释放监听器。
- **归档字节以 JSON 跨 IPC**：原生保存把归档字节作为 JSON 数字数组传输；超大 Session 导出在写盘前需要支付编码开销。
