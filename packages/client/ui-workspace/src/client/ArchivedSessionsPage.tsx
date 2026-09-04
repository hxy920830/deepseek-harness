/**
 * Settings page for archived Sessions. The Workspace plugin owns the section
 * entry and supplies projected Session and Workspace lists; mutations stay on
 * the runtime Workspace service.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconCloseOutline16,
  IconEllipsisOutline16, IconFolderClose16, IconSearchOutline16, IconTrashOutline16, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ArchivedSessionView, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import css from './ArchivedSessionsPage.module.css'

type Translate = WorkspaceBrowserProps['t']
type ScopeFilter = 'all' | 'workspace' | 'ungrouped'

/** Workspace projections and archive actions supplied to the settings page. */
interface ArchivedSessionsPageProps {
  workspaces: readonly WorkspaceView[]
  loadArchivedSessions: () => Promise<readonly ArchivedSessionView[]>
  restoreSession: (sessionId: SessionId) => Promise<void>
  deleteArchivedSession: (sessionId: SessionId) => Promise<void>
  t: Translate
}

/** Host actions injected into the archived Sessions settings section. */
export interface ArchivedSessionsSettingsInjected {
  /** Query every archived Session independently from the live Session mirror. */
  loadArchivedSessions: () => Promise<readonly ArchivedSessionView[]>
  /** Restore one archived Session to ordinary browsing surfaces. */
  restoreSession: (sessionId: SessionId) => Promise<void>
  /** Permanently delete one archived Session and its durable log. */
  deleteArchivedSession: (sessionId: SessionId) => Promise<void>
}

/** Props bound by the settings section slot. */
export type ArchivedSessionsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'workspace'>
  & ArchivedSessionsSettingsInjected

interface ArchivedGroup {
  key: string
  workspaceId?: WorkspaceId
  label: string
  rows: readonly ArchivedSessionView[]
}

type DeleteTarget =
  | { kind: 'session'; sessionId: SessionId; label: string }
  | { kind: 'group'; sessionIds: readonly SessionId[]; label: string }
  | { kind: 'all'; sessionIds: readonly SessionId[] }

/** Format one session timestamp with the application's active locale. */
function formatTimestamp(timestamp: number, t: Translate): string {
  const date = new Date(timestamp)
  const day = t('date.ymd', {
    y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(),
  })
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${day}, ${hour}:${minute}`
}

/** Derive stable Workspace groups from the archive set and current list projection. */
function deriveArchivedGroups(
  sessions: readonly ArchivedSessionView[],
  workspaces: readonly WorkspaceView[],
  query: string,
  scope: ScopeFilter,
  workspaceId: WorkspaceId | 'all',
  ungroupedLabel: string,
): ArchivedGroup[] {
  const accounted = new Set<SessionId>()
  const byId = new Map(sessions.map(session => [session.sessionId, session]))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (id: SessionId): ArchivedSessionView | undefined => {
    const summary = byId.get(id)
    if (summary === undefined) return undefined
    if (normalizedQuery !== '' && !summary.title.toLocaleLowerCase().includes(normalizedQuery)) return undefined
    return summary
  }
  const groups: ArchivedGroup[] = []
  if (scope !== 'ungrouped') {
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) accounted.add(id)
      if (workspaceId !== 'all' && workspace.workspaceId !== workspaceId) continue
      const members = new Set(workspace.sessionIds)
      const rows = sessions
        .filter(session => members.has(session.sessionId))
        .map(session => matches(session.sessionId))
        .filter(row => row !== undefined)
      if (rows.length > 0) groups.push({
        key: workspace.workspaceId,
        workspaceId: workspace.workspaceId,
        label: workspace.title,
        rows,
      })
    }
  } else {
    for (const workspace of workspaces) for (const id of workspace.sessionIds) accounted.add(id)
  }
  if (scope !== 'workspace' && workspaceId === 'all') {
    const rows = sessions
      .filter(session => !accounted.has(session.sessionId))
      .filter(session => normalizedQuery === '' || session.title.toLocaleLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId))
    if (rows.length > 0) groups.unshift({ key: '', label: ungroupedLabel, rows })
  }
  return groups
}

/** Small menu-backed filter control used by both archive filters. */
function FilterMenu({ label, items, selectedId, onSelect }: {
  label: string
  items: readonly { id: string; label: string }[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={selectedId}
      onSelect={(id) => { onSelect(id); setOpen(false) }}
      portal
      anchor={(
        <button
          type="button"
          className={css.filterButton}
          aria-label={label}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span>{items.find(item => item.id === selectedId)?.label ?? label}</span>
          <IconChevronDownOutline14 />
        </button>
      )}
    />
  )
}

/** Project-level destructive menu matching the compact group-header affordance. */
function GroupActions({ label, onDelete, t }: { label: string; onDelete: () => void; t: Translate }) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      align="end"
      portal
      items={[{
        id: 'delete', label: t('archive.deleteGroup'), danger: true,
        icon: <IconTrashOutline16 />,
      }]}
      onSelect={() => { setOpen(false); onDelete() }}
      anchor={(
        <button
          type="button"
          className={css.groupMenu}
          aria-label={t('archive.groupActions.aria', { name: label })}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}

/**
 * Render the archived Session management page.
 * @param props - authoritative query, Workspace grouping data, and mutation actions.
 * @returns the archive manager rendered inside the Settings content region.
 */
export function ArchivedSessionsPage({
  workspaces, loadArchivedSessions, restoreSession, deleteArchivedSession, t,
}: ArchivedSessionsPageProps) {
  const [sessions, setSessions] = useState<readonly ArchivedSessionView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | 'all'>('all')
  const [target, setTarget] = useState<DeleteTarget | null>(null)
  const [pendingSessionIds, setPendingSessionIds] = useState<ReadonlySet<SessionId>>(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Query once per page opening; slot prop refreshes must not restart an in-flight archive read.
  const loader = useRef(loadArchivedSessions)
  const loadGeneration = useRef(0)
  loader.current = loadArchivedSessions

  const load = useCallback((): void => {
    const generation = ++loadGeneration.current
    setLoadError(null)
    loader.current().then((items) => {
      if (generation === loadGeneration.current) setSessions(items)
    }).catch((reason: unknown) => {
      if (generation !== loadGeneration.current) return
      setLoadError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])
  useEffect(() => {
    load()
    return () => { loadGeneration.current++ }
  }, [load])

  const allGroups = useMemo(() => deriveArchivedGroups(
    sessions ?? [], workspaces, '', 'all', 'all', t('group.ungrouped'),
  ), [sessions, t, workspaces])
  const groups = useMemo(() => deriveArchivedGroups(
    sessions ?? [], workspaces, query, scope, workspaceId, t('group.ungrouped'),
  ), [query, scope, sessions, t, workspaceId, workspaces])
  const allSessionIds = sessions?.map(session => session.sessionId) ?? []
  const visibleCount = groups.reduce((count, group) => count + group.rows.length, 0)
  const scopeItems = [
    { id: 'all', label: t('archive.filter.all') },
    { id: 'workspace', label: t('archive.filter.workspace') },
    { id: 'ungrouped', label: t('archive.filter.ungrouped') },
  ]
  const workspaceItems = [
    { id: 'all', label: t('archive.filter.allWorkspaces') },
    ...workspaces.map(workspace => ({ id: workspace.workspaceId as string, label: workspace.title })),
  ]
  const mutateSession = (sessionId: SessionId, mutation: () => Promise<void>): void => {
    setPendingSessionIds(previous => new Set([...previous, sessionId]))
    setError(null)
    mutation().then(() => {
      setSessions(previous => previous?.filter(session => session.sessionId !== sessionId) ?? null)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      setPendingSessionIds((previous) => {
        const next = new Set(previous)
        next.delete(sessionId)
        return next
      })
    })
  }
  const confirmDelete = (): void => {
    if (target === null || deleting) return
    setDeleting(true)
    setError(null)
    const deleteInOrder = async (sessionIds: readonly SessionId[]): Promise<void> => {
      const failures: unknown[] = []
      for (const sessionId of sessionIds) {
        try {
          await deleteArchivedSession(sessionId)
          setSessions(previous => previous?.filter(session => session.sessionId !== sessionId) ?? null)
        } catch (reason: unknown) {
          failures.push(reason)
        }
      }
      if (failures.length > 0) {
        const first = failures[0]
        const message = first instanceof Error ? first.message : String(first)
        throw new Error(t('archive.deleteFailures', { n: failures.length, message }))
      }
    }
    const operation = target.kind === 'session'
      ? deleteArchivedSession(target.sessionId).then(() => {
        setSessions(previous => previous?.filter(session => session.sessionId !== target.sessionId) ?? null)
      })
      : deleteInOrder(target.sessionIds)
    operation.then(() => { setTarget(null) }).catch((reason: unknown) => {
      setTarget(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setDeleting(false) })
  }
  const targetLabel = target?.kind === 'session' || target?.kind === 'group' ? target.label : ''

  return (
    <section className={css.page} aria-labelledby="archived-sessions-title">
      <div className={css.content}>
        <header className={css.header}>
          <h2 id="archived-sessions-title">{t('archive.title')}</h2>
          <Button
            variant="ghost"
            className={css.deleteAll}
            disabled={allSessionIds.length === 0}
            onClick={() => { setTarget({ kind: 'all', sessionIds: allSessionIds }) }}
          >
            <IconTrashOutline16 />
            {t('archive.deleteAll')}
          </Button>
        </header>

        <div className={css.filters}>
          <label className={css.search}>
            <IconSearchOutline16 />
            <input
              type="search"
              value={query}
              placeholder={t('archive.search.placeholder')}
              aria-label={t('archive.search.aria')}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            {query !== '' && (
              <button type="button" aria-label={t('search.clear')} onClick={() => { setQuery('') }}>
                <IconCloseOutline16 size={14} />
              </button>
            )}
          </label>
          <FilterMenu
            label={t('archive.filter.scope')}
            items={scopeItems}
            selectedId={scope}
            onSelect={(id) => {
              setScope(id as ScopeFilter)
              if (id === 'ungrouped') setWorkspaceId('all')
            }}
          />
          <FilterMenu
            label={t('archive.filter.workspaceLabel')}
            items={workspaceItems}
            selectedId={workspaceId}
            onSelect={(id) => {
              setWorkspaceId(id as WorkspaceId | 'all')
              if (id !== 'all') setScope('workspace')
            }}
          />
        </div>

        {(error ?? loadError) !== null && (
          <div className={css.error} role="alert">
            <span>{error ?? loadError}</span>
            {loadError !== null && <Button variant="outline" onClick={load}>{t('archive.retry')}</Button>}
          </div>
        )}
        {sessions === null ? (loadError === null
          ? <div className={css.empty} role="status">{t('archive.loading')}</div>
          : null
        ) : visibleCount === 0 ? (
          <div className={css.empty}>{query.trim() === '' ? t('archive.empty') : t('archive.emptySearch')}</div>
        ) : (
          <div className={css.groups}>
            {groups.map(group => (
              <section key={group.key} className={css.group} aria-label={group.label}>
                <div className={css.groupHeader}>
                  <div className={css.groupTitle}>
                    <IconFolderClose16 />
                    <span>{group.label}</span>
                  </div>
                  <span className={css.count}>{t('sessions.count.other', { n: group.rows.length })}</span>
                  <GroupActions
                    label={group.label}
                    t={t}
                    onDelete={() => {
                      const allGroup = allGroups.find(candidate => candidate.key === group.key)
                      setTarget({
                        kind: 'group',
                        sessionIds: allGroup?.rows.map(row => row.sessionId) ?? [],
                        label: group.label,
                      })
                    }}
                  />
                </div>
                <div className={css.rows}>
                  {group.rows.map((row) => {
                    const pending = pendingSessionIds.has(row.sessionId)
                    return (
                      <article key={row.sessionId} className={css.row}>
                        <div className={css.rowMain}>
                          <div className={css.rowTitle}>{row.title}</div>
                          <time dateTime={new Date(row.updatedAt).toISOString()}>{formatTimestamp(row.updatedAt, t)}</time>
                        </div>
                        <Tooltip label={t('archive.deleteSession')}>
                          <button
                            type="button"
                            className={css.rowDelete}
                            disabled={pending}
                            aria-label={t('archive.deleteSession.aria', { name: row.title })}
                            onClick={() => { setTarget({ kind: 'session', sessionId: row.sessionId, label: row.title }) }}
                          >
                            <IconTrashOutline16 />
                          </button>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          disabled={pending}
                          onClick={() => { mutateSession(row.sessionId, () => restoreSession(row.sessionId)) }}
                        >
                          {pending ? t('archive.restoring') : t('archive.restore')}
                        </Button>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={() => { if (!deleting) setTarget(null) }}
        closeLabel={t('close')}
        title={target?.kind === 'all'
          ? t('archive.confirmAll.title')
          : target?.kind === 'group'
            ? t('archive.confirmGroup.title')
            : t('archive.confirmSession.title')}
        footer={(
          <>
            <Button variant="outline" disabled={deleting} onClick={() => { setTarget(null) }}>{t('cancel')}</Button>
            <Button variant="primary" className={css.confirmDelete} disabled={deleting} onClick={confirmDelete}>
              {deleting ? t('archive.deleting') : t('archive.delete')}
            </Button>
          </>
        )}
      >
        <p>{target?.kind === 'all'
          ? t('archive.confirmAll.desc')
          : target?.kind === 'group'
            ? t('archive.confirmGroup.desc', { name: targetLabel })
            : t('archive.confirmSession.desc', { name: targetLabel })}</p>
      </Modal>
    </section>
  )
}

/**
 * Render the archive manager inside the Settings navigation surface.
 * @param props - settings owner share, Workspace snapshot hook, locale, and archive mutations.
 * @returns the archived Sessions settings page.
 */
export function ArchivedSessionsSettingsSection({
  useWorkspaces, loadArchivedSessions, restoreSession, deleteArchivedSession, t,
}: ArchivedSessionsSettingsSectionProps) {
  const workspaces = useWorkspaces(state => state.items)
  return (
    <ArchivedSessionsPage
      workspaces={workspaces}
      loadArchivedSessions={loadArchivedSessions}
      restoreSession={restoreSession}
      deleteArchivedSession={deleteArchivedSession}
      t={t}
    />
  )
}
