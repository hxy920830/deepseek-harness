---
description: "供 dsh Web 客户端组合使用的 Tauri 桌面关闭行为与原生 Session 日志归档操作，面向用户和维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-desktop

[English](README.md) | 中文

## 概述

`dsh-client-ui-desktop` 让官方 Tauri 桌面窗口在用户关闭时询问、最小化或退出，也让 Session 导出流程可以把归档保存到选定的本地目录。通用设置会把关闭行为和 Session 日志目录持久化到 Host 设置文档。普通浏览器不会添加任何桌面 UI，桌面客户端则使用共享的 locale、主题、设置和 slot 服务。原生命令会在改变窗口或文件系统前校验请求 id、归档名称和目标目录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当页面运行在官方 Tauri WebView 中时，在桌面 Web 组合中挂载本插件。通用设置页面随后会提供关闭行为选择器和 Session 日志目录选择器；Session 导出包可以使用发布的 `desktopSessionFiles` 能力原生保存归档。

### 何时选择

当本地 Tauri 桌面 shell 与 Host 位于同一台机器时选择本包。纯浏览器部署不会获得桌面设置行或原生命令，远程浏览器部署应继续使用 Session 导出的浏览器下载路径。

### 组合

```yaml
- id: desktop-ui
  name: '@deepseek-ai/dsh-client-ui-desktop'
```

组合必须提供本包客户端元数据声明的 locale、layout、settings、settings-general 和 slot 服务。

### 配置

本插件没有 Cordis 配置字段。用户通过通用设置配置 `closeBehavior` 和 `sessionLogDir`；空的 `sessionLogDir` 会把归档目标位置交给浏览器或平台默认行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 半包注册一个持久的 `ui-desktop` 设置命名空间。浏览器半包在 Tauri 不可用时立即退出，否则通过 `ctx.settingsScope` 绑定该命名空间，并通过已声明的 slot 注册两个通用设置行和一个关闭对话框 overlay。

### 桌面关闭流程

控制器先监听 `desktop://close-requested`，再调用 `desktop_ready`。它会忽略不递增的请求 id，直接处理已保存的 `minimize` 或 `exit` 选择，并把 `ask` 请求交给共享 Modal。记住的选择会先通过设置 scope 写入，再解析原生请求；释放时会取消一个待处理请求并移除监听器。

### Session 日志文件能力

配置目录后，`desktopSessionFiles.save` 会把归档字节和符合约定的 `dsh-session-<id>.zip` 名称发送给 Rust。该能力还通过仅拆分自身保存操作返回的路径，提供定位文件和默认程序打开操作。导出包可以消费这个可选服务，不需要导入 Tauri API。

### 原生边界

Tauri capability 只向回环地址承载的主窗口授予关闭、目录选择、归档保存、定位和打开命令，以及关闭事件监听。Rust 会在执行原生操作前检查请求 id、动作、归档名称、绝对目录和 WebView origin。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当桌面包的说明不够时阅读以下页面。它们涵盖设置提供方、Session 导出消费者以及周围的浏览器组合。

- [ui-settings](../ui-settings/README.zh.md)——拥有浏览器设置 scope 和共享设置 mirror。
- [ui-settings-general](../ui-settings-general/README.zh.md)——承载通用设置页及其 item slot。
- [session-log-export](../../session-query/session-log-export/README.zh.md)——在可用时消费原生 Session 日志文件操作。
- [Tauri 桌面 shell](../../../apps/desktop/README.zh.md)——拥有原生窗口、命令和 capability 配置。

-----

<a id="model-experience"></a>
## 模型体验

无。本包管理桌面生命周期和文件操作，不注册面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明原生桌面操作何时可用，以及大型归档传输的开销。

- **仅限官方 Tauri 运行时**——普通浏览器会话不会获得桌面设置行、关闭 overlay、原生事件监听器或原生命令调用。
- **仅一个待处理关闭请求**——Rust 处理程序一次只接受一个关闭请求，释放时会先取消该请求，再释放浏览器监听器。
- **归档字节以 JSON 跨 IPC**——原生归档保存会把字节作为 JSON 数字数组传输，因此大型 Session 导出会产生编码和传输开销。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时检查：** 不发布不变式伴生入口，因为设置 schema 拥有持久值有效性，原生命令处理程序拥有关闭请求的授权与状态；两者都没有可供包自有不变式独立观察的关系。
