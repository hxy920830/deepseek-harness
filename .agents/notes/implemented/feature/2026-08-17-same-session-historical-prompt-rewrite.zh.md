# Agent Note: 同一 Session 的历史提问重写

Status: implemented

[English](2026-08-17-same-session-historical-prompt-rewrite.md) | 中文

## 问题

用户需要在已完成轮次后修正一条普通文本提问，并在同一个 Session 标识下继续对话。分支会创建另一个 Session，失去原 Session 的所有权与工作区连续性；修改旧日志事件则会破坏只追加持久化与回放。

## 决定

Session prompt Remote 仅在请求包含非空文本且模式为 queue 时接受可选的 `rewriteFromSeq`。Host 仅在普通 Agent 空闲且 inbox 为空时接收该请求，并验证目标序号对应当前可见 surface 中的一条普通用户消息，且消息只包含有意义的文本。Host 从该消息计算直到当前尾部的完整 surface 后缀，并在同一个 Agent 与 Session 中排入替换消息。

替换消息的 source 携带包含 `startSeq`、`endSeq` 与全部 `shadowedSeqs` 条目的 `UserRewriteMetadata`。agent loop（智能体循环）把这些可传输数字转换为 `SessionSeq`，使用 `surfaceOp: { op: 'replace', start, end }` 追加消息，并通过 `sourceEventSeqs` 引用同一组序号。因此旧事件全部保留在持久日志中，替换消息成为当前模型 surface；之后可以继续以替换事件本身为目标重写。

Session API、Client Session、Conversation service 与 Chat slots 共同暴露一个 `rewritePrompt` 操作。subagent 地址返回 `subagent/not-resumable`，因此只有普通 Session 所有者可以执行直接的人类历史编辑。Chat 为纯文本普通用户消息提供编辑操作，在准入失败时保留编辑器，并在 Agent 开始运行或收到排队输入时关闭编辑态。snapshot builder 移除被遮蔽的可见后缀，并把替换消息保留在原对话位置。

## 考虑过的替代方案

**从选中的提问处分支 Session。** 不采用，因为用户要求继续同一段对话：分支会改变 Session 标识，拆分持久化，并改变工作区与 Agent 所有权。

**删除或修改旧后缀。** 不采用，因为已发布的 Session 日志只追加；保留被引用的事件可以回放、审计，并重建替换操作。

**在 Agent 运行中或存在排队输入时允许编辑。** 不采用，因为替换准入前 surface 尾部与请求上下文可能变化；空闲状态加空 inbox 为 Host 提供一个稳定的准入点。

**只在 Client projection 中应用替换。** 不采用，因为下一次模型请求、持久化读取方、SDK 与冷 Session projection 必须从持久日志导出相同的 surface。

## 后果

历史重写通过追加事件实现，会增加日志大小，但保留每个旧版本，并使替换操作可由日志重建。替换 surface 会增加 Session replacement generation，因此模型恢复时请求组装会在编辑后的提问处记录新的 request series。

只有包含非空文本、没有附件或其他内容块的普通用户消息可编辑。该操作不接受 steering、图片、文件、空文本、运行中的 Agent、非空 inbox、过期序号或 subagent Session。Host 准入失败时，既有 surface 与 Client 编辑器都保留，用户可以再次尝试。

## 测试

`packages/core/agent-loop/tests/loop.spec.ts` 验证同一 Session 的替换、完整遮蔽覆盖，以及下一次模型请求移除旧后缀。`packages/api/session-controller/tests/historical-prompt-rewrite.host.spec.ts` 验证 Host 准入、拒绝原因、过期目标、空闲与 inbox 条件，以及重写当前替换。`packages/api/session-controller/tests/session.client.spec.ts` 验证普通 Session 与 subagent Client 行为。UI 测试验证编辑、取消、Enter 与 Shift+Enter、IME 组合输入、失败恢复和 projection 更新。
