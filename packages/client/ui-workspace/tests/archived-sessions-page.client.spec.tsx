// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ArchivedSessionsPage } from '../src/client/ArchivedSessionsPage.tsx'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const summary = (id: string, title: string, updatedAt: number) => ({ sessionId: sid(id), title, updatedAt })
const workspace = (id: string, title: string, sessionIds: string[]): WorkspaceView => ({
  workspaceId: wid(id), path: `C:\\projects\\${id}`, title,
  sessionIds: sessionIds.map(sid),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function mount(overrides: Partial<React.ComponentProps<typeof ArchivedSessionsPage>> = {}) {
  const props: React.ComponentProps<typeof ArchivedSessionsPage> = {
    loadArchivedSessions: vi.fn(async () => [
      summary('loose', 'Loose chat', Date.UTC(2026, 7, 16, 5, 18)),
      summary('alpha-1', 'Alpha first', Date.UTC(2026, 7, 15, 4, 10)),
      summary('alpha-2', 'Alpha second', Date.UTC(2026, 7, 14, 3, 5)),
    ]),
    workspaces: [workspace('alpha', 'Alpha', ['alpha-1', 'active', 'alpha-2'])],
    restoreSession: vi.fn(async () => {}),
    deleteArchivedSession: vi.fn(async () => {}),
    t,
    ...overrides,
  }
  render(<ArchivedSessionsPage {...props} />)
  return props
}

describe('ArchivedSessionsPage', () => {
  it('groups only archived sessions by project and keeps loose sessions separate', async () => {
    mount()
    await screen.findByText('Loose chat')
    const loose = screen.getByRole('region', { name: '未分组' })
    expect(within(loose).getByText('Loose chat')).toBeTruthy()
    const alpha = screen.getByRole('region', { name: 'Alpha' })
    expect(within(alpha).getByText('Alpha first')).toBeTruthy()
    expect(within(alpha).getByText('Alpha second')).toBeTruthy()
  })

  it('filters by title, scope, and project', async () => {
    mount()
    await screen.findByText('Loose chat')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索已归档会话' }), {
      target: { value: 'second' },
    })
    expect(screen.getByText('Alpha second')).toBeTruthy()
    expect(screen.queryByText('Alpha first')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索已归档会话' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: '筛选会话范围' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '未分组会话' }))
    expect(screen.getByText('Loose chat')).toBeTruthy()
    expect(screen.queryByText('Alpha first')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '筛选工作区' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(screen.getByText('Alpha first')).toBeTruthy()
    expect(screen.queryByText('Loose chat')).toBeNull()
  })

  it('restores a row and disables it while the mutation is pending', async () => {
    let settle: (() => void) | undefined
    const restoreSession = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    mount({ restoreSession })
    await screen.findByText('Loose chat')
    const button = screen.getAllByRole('button', { name: '取消归档' })[0]!
    fireEvent.click(button)
    expect(restoreSession).toHaveBeenCalledWith('loose')
    expect(screen.getByRole('button', { name: '正在恢复…' }).hasAttribute('disabled')).toBe(true)
    settle?.()
    await waitFor(() => { expect(screen.queryByText('Loose chat')).toBeNull() })
  })

  it('confirms permanent row deletion', async () => {
    const deleteArchivedSession = vi.fn(async (_id: SessionId) => {})
    mount({ deleteArchivedSession })
    await screen.findByText('Loose chat')

    fireEvent.click(screen.getByRole('button', { name: '删除会话“Loose chat”' }))
    expect(screen.getByRole('dialog', { name: '删除已归档会话' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(deleteArchivedSession).toHaveBeenCalledWith('loose') })
  })

  it('deletes one project or the complete archive through sequential row mutations', async () => {
    const deleteArchivedSession = vi.fn(async () => {})
    mount({ deleteArchivedSession })
    await screen.findByText('Loose chat')
    fireEvent.click(screen.getByRole('button', { name: '工作区“Alpha”的已归档会话操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除工作区中的全部已归档会话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(deleteArchivedSession).toHaveBeenCalledWith('alpha-1')
      expect(deleteArchivedSession).toHaveBeenCalledWith('alpha-2')
    })

    cleanup()
    const deleteAll = vi.fn(async (_id: SessionId) => {})
    mount({ deleteArchivedSession: deleteAll })
    await screen.findByText('Loose chat')
    fireEvent.click(screen.getByRole('button', { name: '全部删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(deleteAll).toHaveBeenCalledTimes(3) })
    expect(deleteAll.mock.calls.map(call => call[0])).toEqual(['loose', 'alpha-1', 'alpha-2'])
  })

  it('shows an initial loading state and retries a failed archive query', async () => {
    const loadArchivedSessions = vi.fn()
      .mockRejectedValueOnce(new Error('archive unavailable'))
      .mockResolvedValueOnce([summary('loose', 'Loose chat', 1)])
    mount({ loadArchivedSessions })
    expect(screen.getByRole('status').textContent).toBe('正在加载已归档会话…')
    expect((await screen.findByRole('alert')).textContent).toContain('archive unavailable')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Loose chat')).toBeTruthy()
    expect(loadArchivedSessions).toHaveBeenCalledTimes(2)
  })

  it('keeps failed rows after an ordered bulk delete and reports the failure count', async () => {
    const deleteArchivedSession = vi.fn(async (id: SessionId) => {
      if (id === 'alpha-1') throw new Error('log is locked')
    })
    mount({ deleteArchivedSession })
    await screen.findByText('Loose chat')
    fireEvent.click(screen.getByRole('button', { name: '全部删除' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(deleteArchivedSession).toHaveBeenCalledTimes(3) })
    expect(deleteArchivedSession.mock.calls.map(call => call[0])).toEqual(['loose', 'alpha-1', 'alpha-2'])
    expect(await screen.findByText('Alpha first')).toBeTruthy()
    expect(screen.queryByText('Loose chat')).toBeNull()
    expect(screen.queryByText('Alpha second')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('1 个会话删除失败：log is locked')
  })

  it('renders the English management copy through the same controls', async () => {
    mount({ t: makeTranslate(en, commonEn) })
    expect(await screen.findByRole('heading', { name: 'Archived sessions' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search archived sessions' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Unarchive' })).toHaveLength(3)
  })
})
