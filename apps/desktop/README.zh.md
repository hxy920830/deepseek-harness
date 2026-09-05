# DeepSeek Harness 桌面客户端

[English](README.md) | 中文

该 Tauri 2 桌面应用负责原生窗口、系统托盘、受限关闭握手和子进程生命周期。它使用操作系统分配的回环端口启动现有 `dsh web` 组合，等待 `dsh web:` 就绪行，然后在主 WebView 中加载该 URL。Web Host 继续负责注入 `window.__DSH_BOOT__`、提供客户端插件 bundle，并通过同源 HTTP 和 WebSocket 承载 API 流量；桌面壳不复制插件名录。

## 开发

在仓库根目录运行：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

Tauri 开发钩子会先构建仓库。随后 Rust 进程从当前 checkout 启动 `node --import tsx/esm apps/cli/src/bin.ts web --host 127.0.0.1 --port 0 --no-open`，并保持其 stdin 管道开启，作为父进程生命周期通道。该 URL 会加载到 Tauri WebView，而不会交给系统浏览器。

## 窗口与托盘生命周期

关闭主窗口时，应用会与 [`@deepseek-ai/dsh-client-ui-desktop`](../../packages/client/ui-desktop/README.zh.md) 启动带请求 id 检查的握手。Host 设置 `ui-desktop.closeBehavior` 默认为 `ask`，可在通用设置中改为 `minimize` 或 `exit`；本地设置提供方会将该值持久化到 `$DSH_HOME/settings.yaml`。`ask` 路径打开共享 Web UI `Modal`，因此它的颜色、控件和文案会跟随当前应用主题与 locale。Modal 提供 **最小化到托盘**、**退出** 和 **取消**，并可为两个非取消操作选择 **记住我的选择**。

最小化会隐藏窗口，同时 Harness Host 继续运行；取消和 Modal 的关闭操作会保持主窗口开启。左键点击 DeepSeek 托盘图标或选择 **显示 DeepSeek Harness** 会恢复窗口、取消最小化并聚焦。托盘中的 **退出** 会绕过已保存的关闭偏好设置，直接使用同一条有界 Host 关闭路径。

回环地址上的主 WebView 只能监听／取消监听关闭事件，以及调用 `desktop_ready` 和 `desktop_resolve_close`。Rust 只接受当前待处理请求 id 的解析结果，把导航限制在启动时选定的准确 origin，并且不向页面暴露通用 Tauri core 或插件 capability。

桌面壳会在退出前写入 Host stdin。CLI 随后 dispose 完整 Cordis 树，并等待既有的五秒关闭控制器完成；如果桌面父进程消失，stdin EOF 会请求相同的关闭流程。Rust 所有者等待五秒，只有 Host 未完成关闭时才会强制终止它。

## 打包

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
```

构建钩子会运行 [`scripts/stage-runtime.ts`](scripts/stage-runtime.ts)：验证本包的生产 workspace peer 闭包，构建整个仓库，将其生产依赖部署到 Tauri resources，并把当前平台的 Node 可执行文件复制到该目录。安装后的应用使用随包携带的 Node 载体以及已构建的 Web 与插件产物，不依赖系统提供的 `node`、`pnpm` 或 `dsh` 命令。每个安装包都必须在目标操作系统和体系结构上构建，使 Node、原生 addon、WebView 元数据和签名与目标一致。

`src-tauri/icons/` 下的图标由 [`apps/web/public/favicon.svg`](../web/public/favicon.svg) 生成；后者仍是唯一可编辑的 DeepSeek 图标源。

## 已知限制

- 首个桌面版本沿用现有回环 HTTP/WebSocket carrier。若改用原生 IPC，必须为动态启动清单、客户端插件 bundle、单次调用、两条下行流和响应实现一套完整 carrier。
