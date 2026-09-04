import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionSeq as SessionSeqType, type UserMessage } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import { createScope } from '@deepseek-ai/dsh-scope'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'

const SESSION = SessionId('historical-prompt-rewrite')

async function harness(): Promise<{
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  runMaintenance: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SESSION, { meta: { cwd: '/workspace' } })
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const followup = vi.fn()
  const runMaintenance = vi.fn(async <Value>(task: (signal: AbortSignal) => Promise<Value>) => (
    task(new AbortController().signal)
  ))
  const agent = {
    id: session.id,
    session,
    inbox,
    status: 'idle',
    ctx: undefined,
    steer: vi.fn(),
    followup,
    cancel: vi.fn(),
    runMaintenance,
  } as unknown as Agent
  ;(agent as { ctx: Context }).ctx = createScope(ctx, agent).ctx
  ctx.agents.register(agent)
  ctx.provide('connection', {
    fetch: { register: () => () => {} },
  } as never)
  ctx.provide('attachments', Object.setPrototypeOf({}, AttachmentStore.prototype) as never)
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
  } as never)
  const selection: ModelSelectionRef = {
    current: { provider: 'fixture', model: 'fixture-model' },
    assembled: undefined,
  }
  const agents = {
    resolveAgent: () => Promise.resolve({ agent }),
    selectionFor: () => selection,
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
  } as unknown as ApiSessionAgentController
  new FileUploads(ctx)
  return {
    ctx,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    agent,
    followup,
    runMaintenance,
  }
}

function request(seq: number, text: string, requestId: string): Parameters<SessionCommandController['prompt']>[0] {
  return {
    requestId: requestId as SessionRequestId,
    sessionId: SESSION,
    mode: 'queue',
    content: [{ type: 'text', text }],
    rewriteFromSeq: seq,
  }
}

function appendUser(agent: Agent, text: string, source: Record<string, unknown> = { kind: 'user' }): SessionSeqType {
  return agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: source as never,
  }), { surfaceOp: 'append' }).seq
}

describe('Historical prompt rewrite', () => {
  it('queues a replacement with metadata for the same Session', async () => {
    const h = await harness()
    const targetSeq = appendUser(h.agent, 'original question')

    await expect(h.controller.prompt(request(targetSeq, 'edited question', 'rewrite-1')))
      .resolves.toEqual({ accepted: true })

    expect(h.runMaintenance).toHaveBeenCalledOnce()
    const replacement = h.followup.mock.calls[0]?.[0] as UserMessage | undefined
    expect(replacement).toMatchObject({
      content: [{ type: 'text', text: 'edited question' }],
      source: {
        kind: 'user',
        rewrite: { startSeq: targetSeq, endSeq: targetSeq, shadowedSeqs: [targetSeq] },
      },
    })
  })

  it('rejects a stale, non-text, busy, and inbox-blocked rewrite', async () => {
    const stale = await harness()
    await expect(stale.controller.prompt(request(999, 'edited', 'rewrite-stale')))
      .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'REWRITE_TARGET_INVALID' } })

    const nonText = await harness()
    const imageSeq = nonText.agent.session.append('user/message', createUserMessage({
      content: [],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    await expect(nonText.controller.prompt(request(imageSeq, 'edited', 'rewrite-empty')))
      .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'REWRITE_TARGET_INVALID' } })

    const busy = await harness()
    const busySeq = appendUser(busy.agent, 'busy target')
    Object.assign(busy.agent, { status: 'running' })
    await expect(busy.controller.prompt(request(busySeq, 'edited', 'rewrite-busy')))
      .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'REWRITE_REQUIRES_IDLE' } })

    const queued = await harness()
    const queuedSeq = appendUser(queued.agent, 'queued target')
    queued.agent.inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: 'pending' }],
      source: { kind: 'user' },
    }))
    await expect(queued.controller.prompt(request(queuedSeq, 'edited', 'rewrite-inbox')))
      .rejects.toMatchObject({ code: 'session/agent-busy', details: { reason: 'REWRITE_REQUIRES_IDLE' } })
  })

  it('accepts a rewrite of the current replacement', async () => {
    const h = await harness()
    const targetSeq = appendUser(h.agent, 'first question')
    await h.controller.prompt(request(targetSeq, 'second question', 'rewrite-1'))
    const firstReplacement = h.followup.mock.calls[0]?.[0] as UserMessage | undefined
    if (firstReplacement === undefined) throw new Error('first replacement was not queued')
    const firstReplacementEvent = h.agent.session.append('user/message', firstReplacement, {
      surfaceOp: { op: 'replace', start: targetSeq, end: targetSeq },
      sourceEventSeqs: [targetSeq],
    })

    await expect(h.controller.prompt(request(firstReplacementEvent.seq, 'third question', 'rewrite-2')))
      .resolves.toEqual({ accepted: true })
    expect(h.followup).toHaveBeenCalledTimes(2)
    expect(h.followup.mock.calls[1]?.[0]).toMatchObject({
      source: { rewrite: { startSeq: firstReplacementEvent.seq } },
    })
  })
})
