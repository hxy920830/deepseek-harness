# Agent Note: Same-session historical prompt rewrite

Status: implemented

English | [中文](2026-08-17-same-session-historical-prompt-rewrite.zh.md)

## Problem

A user needs to correct an ordinary text prompt after a completed turn and continue the conversation under the same Session identity. Forking creates a different Session and loses the original Session's ownership and workspace continuity, while changing an old log event would break append-only persistence and replay.

## Decision

The Session prompt Remote accepts an optional `rewriteFromSeq` only for a queued, non-empty text prompt. The Host accepts it only while the ordinary Agent is idle and its inbox is empty, then validates that the requested sequence is a visible ordinary user message containing only meaningful text. It computes the complete current surface suffix from that message through the current tail and queues a replacement message in the same Agent and Session.

The replacement source carries `UserRewriteMetadata` with `startSeq`, `endSeq`, and every `shadowedSeqs` entry. The agent loop converts those wire-safe numbers to `SessionSeq` values, appends the message with `surfaceOp: { op: 'replace', start, end }`, and cites the same sequence list through `sourceEventSeqs`. Session validation therefore keeps every old event in the durable log while making the replacement the current model surface; a later rewrite can target the replacement event itself.

The Session API, Client Session, Conversation service, and Chat slots expose one `rewritePrompt` operation. A subagent address returns `subagent/not-resumable`, so only the ordinary Session owner can exercise direct human history editing. Chat offers an edit action for plain-text ordinary user messages, keeps the editor on admission failure, and closes it when the Agent starts running or receives queued input. The snapshot builder removes the shadowed visible suffix and keeps the replacement in its original conversation position.

## Alternatives considered

**Fork the Session at the selected prompt.** Rejected because the user asked to continue the same conversation: a fork changes the Session identity, splits persistence, and changes workspace and Agent ownership.

**Delete or mutate the old suffix.** Rejected because released Session logs are append-only; retaining the cited events preserves replay, audit, and reconstruction of the replacement operation.

**Allow edits while running or with queued input.** Rejected because the surface tail and request context can change before the replacement is admitted; idle status plus an empty inbox gives the Host one stable admission point.

**Apply the replacement only in the Client projection.** Rejected because the next model request, persistence reader, SDK, and cold Session projection must derive the same surface from the durable log.

## Consequences

History rewrites append events and increase log size, but they preserve every prior generation and make the replacement operation reconstructable. Replacing the surface increments the Session replacement generation, so request assembly records a new request series when the model resumes from the edited prompt.

Only ordinary user messages with non-blank text and no attachments or other content blocks are editable. The operation does not accept steering, images, files, empty text, active Agents, pending inbox items, stale sequences, or subagent Sessions. Failed Host admission leaves the existing surface and Client editor available for another attempt.

## Testing

`packages/core/agent-loop/tests/loop.spec.ts` verifies same-Session replacement, complete shadow coverage, and removal of the old suffix from the next model request. `packages/api/session-controller/tests/historical-prompt-rewrite.host.spec.ts` verifies Host admission, rejection reasons, stale targets, idle and inbox requirements, and rewriting the current replacement. `packages/api/session-controller/tests/session.client.spec.ts` verifies ordinary and subagent Client behavior. The UI tests verify editing, cancel, Enter versus Shift+Enter, IME composition, failure recovery, and projection updates.
