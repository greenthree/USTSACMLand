import Archive from 'lucide-react/dist/esm/icons/archive'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import Plus from 'lucide-react/dist/esm/icons/plus'
import Save from 'lucide-react/dist/esm/icons/save'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import X from 'lucide-react/dist/esm/icons/x'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { LoadingState } from '../../components/LoadingState'
import {
  deleteAdminDailyProblem,
  fetchAdminDailyProblems,
  saveAdminDailyProblem,
} from '../../features/daily-problem/dailyProblemApi'
import { demoDailyProblems } from '../../features/daily-problem/dailyProblemDemo'
import { platformLabels } from '../../lib/platforms'
import { supabase } from '../../lib/supabase'
import type {
  AdminDailyProblem,
  AdminDailyProblemInput,
  DailyProblemStatus,
  Platform,
} from '../../types/domain'
import '../../features/daily-problem/daily-problem.css'

const statusLabels: Record<DailyProblemStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

const problemPlatforms: Platform[] = ['codeforces', 'nowcoder', 'atcoder', 'luogu', 'qoj']

interface EditorValues {
  date: string
  title: string
  sourcePlatform: string
  externalProblemId: string
  sourceUrl: string
  difficulty: string
  tags: string
  trainingNote: string
  estimatedMinutes: string
  status: DailyProblemStatus
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function editorValues(problem: AdminDailyProblem | null): EditorValues {
  return {
    date: problem?.date ?? shanghaiDate(),
    title: problem?.title ?? '',
    sourcePlatform: problem?.sourcePlatform ?? 'codeforces',
    externalProblemId: problem?.externalProblemId ?? '',
    sourceUrl: problem?.sourceUrl ?? '',
    difficulty: problem?.difficulty ?? '',
    tags: problem?.tags.join('，') ?? '',
    trainingNote: problem?.trainingNote ?? '',
    estimatedMinutes: problem?.estimatedMinutes?.toString() ?? '',
    status: problem?.status ?? 'draft',
  }
}

function platformLabel(platform: string): string {
  return platformLabels[platform as Platform] ?? platform
}

function toInput(problem: AdminDailyProblem, status = problem.status): AdminDailyProblemInput {
  return {
    id: problem.id,
    date: problem.date,
    title: problem.title,
    sourcePlatform: problem.sourcePlatform,
    externalProblemId: problem.externalProblemId,
    sourceUrl: problem.sourceUrl,
    difficulty: problem.difficulty,
    tags: problem.tags,
    trainingNote: problem.trainingNote,
    estimatedMinutes: problem.estimatedMinutes,
    status,
    expectedUpdatedAt: problem.updatedAt,
  }
}

export function AdminDailyProblemsPage() {
  const demo = !supabase
  const [problems, setProblems] = useState<AdminDailyProblem[]>(() =>
    demo ? [...demoDailyProblems] : [],
  )
  const [filter, setFilter] = useState<DailyProblemStatus | 'all'>('all')
  const [loading, setLoading] = useState(!demo)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [editing, setEditing] = useState<AdminDailyProblem | null | undefined>(undefined)
  const [values, setValues] = useState<EditorValues>(() => editorValues(null))
  const [formError, setFormError] = useState('')

  const loadProblems = useCallback(async () => {
    if (demo) return
    setLoading(true)
    setNotice('')
    try {
      setProblems(await fetchAdminDailyProblems())
    } catch (reason) {
      setProblems([])
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '每日一题列表读取失败。')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => {
    void loadProblems()
  }, [loadProblems])

  const filteredProblems = useMemo(
    () => (filter === 'all' ? problems : problems.filter((problem) => problem.status === filter)),
    [filter, problems],
  )

  function openEditor(problem: AdminDailyProblem | null) {
    setEditing(problem)
    setValues(editorValues(problem))
    setFormError('')
  }

  function closeEditor() {
    if (busy) return
    setEditing(undefined)
    setFormError('')
  }

  async function submitProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = values.title.trim()
    const sourceUrl = values.sourceUrl.trim()
    const estimatedMinutes = values.estimatedMinutes ? Number(values.estimatedMinutes) : null
    const trainingNote = values.trainingNote.trim()
    const tags = Array.from(
      new Set(
        values.tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    )
    if (!title || title.length > 200) {
      setFormError('题目标题需包含 1 到 200 个字符。')
      return
    }
    try {
      const parsed = new URL(sourceUrl)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error()
    } catch {
      setFormError('原题链接必须是无账号信息的有效 HTTPS 地址。')
      return
    }
    if (sourceUrl.length > 2_000) {
      setFormError('原题链接不能超过 2000 个字符。')
      return
    }
    if (!trainingNote || trainingNote.length > 10_000) {
      setFormError('训练提示需包含 1 到 10000 个字符。')
      return
    }
    if (values.difficulty.trim().length > 40) {
      setFormError('难度说明不能超过 40 个字符。')
      return
    }
    if (values.externalProblemId.trim().length > 100) {
      setFormError('平台题号需包含 1 到 100 个字符。')
      return
    }
    if (!values.externalProblemId.trim()) {
      setFormError('平台题号需包含 1 到 100 个字符。')
      return
    }
    if (tags.length > 12 || tags.some((tag) => tag.length > 40)) {
      setFormError('最多填写 12 个标签，每个标签不能超过 40 个字符。')
      return
    }
    if (
      estimatedMinutes !== null &&
      (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 600)
    ) {
      setFormError('建议用时需为 1 到 600 之间的整数。')
      return
    }

    const input: AdminDailyProblemInput = {
      id: editing?.id ?? null,
      date: values.date,
      title,
      sourcePlatform: values.sourcePlatform,
      externalProblemId: values.externalProblemId.trim(),
      sourceUrl,
      difficulty: values.difficulty.trim(),
      tags,
      trainingNote,
      estimatedMinutes,
      status: values.status,
      expectedUpdatedAt: editing?.updatedAt ?? null,
    }

    setBusy(true)
    setFormError('')
    try {
      const saved = await saveAdminDailyProblem(input)
      if (demo) {
        const next: AdminDailyProblem = {
          id: saved.id,
          date: input.date,
          title: input.title,
          sourcePlatform: input.sourcePlatform,
          externalProblemId: input.externalProblemId,
          sourceUrl: input.sourceUrl,
          difficulty: input.difficulty || '难度待定',
          tags: input.tags,
          trainingNote: input.trainingNote,
          estimatedMinutes: input.estimatedMinutes,
          completionCount: editing?.completionCount ?? 0,
          commentCount: editing?.commentCount ?? 0,
          completedAt: null,
          status: input.status,
          createdAt: editing?.createdAt ?? saved.updatedAt,
          updatedAt: saved.updatedAt,
        }
        setProblems((current) =>
          editing
            ? current.map((problem) => (problem.id === editing.id ? next : problem))
            : [next, ...current],
        )
      } else {
        await loadProblems()
      }
      setNoticeKind('success')
      setNotice(editing ? '每日一题已更新。' : '每日一题已创建。')
      setEditing(undefined)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '每日一题保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function archiveProblem(problem: AdminDailyProblem) {
    setBusy(true)
    setNotice('')
    try {
      const saved = await saveAdminDailyProblem(toInput(problem, 'archived'))
      if (demo) {
        setProblems((current) =>
          current.map((item) =>
            item.id === problem.id
              ? { ...item, status: 'archived', updatedAt: saved.updatedAt }
              : item,
          ),
        )
      } else {
        await loadProblems()
      }
      setNoticeKind('success')
      setNotice(`“${problem.title}”已归档。`)
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '每日一题归档失败。')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft(problem: AdminDailyProblem) {
    if (problem.status !== 'draft') return
    if (!window.confirm(`确定删除草稿“${problem.title}”吗？此操作不可撤销。`)) return
    setBusy(true)
    setNotice('')
    try {
      await deleteAdminDailyProblem(problem.id, problem.updatedAt)
      setProblems((current) => current.filter((item) => item.id !== problem.id))
      setNoticeKind('success')
      setNotice('草稿已删除。')
    } catch (reason) {
      setNoticeKind('error')
      setNotice(reason instanceof Error ? reason.message : '草稿删除失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-page" aria-busy={loading || busy}>
      <section className="admin-page-heading">
        <div>
          <h1>每日一题管理</h1>
          <p>安排每日训练题目，维护公开状态、训练提示与建议用时。</p>
        </div>
        <div className="admin-heading-actions">
          <span className="demo-indicator">{demo ? '演示数据' : '实时数据'}</span>
          <button className="primary-button" type="button" onClick={() => openEditor(null)}>
            <Plus size={16} aria-hidden="true" />
            新建题目
          </button>
        </div>
      </section>

      <div className="dp-admin-toolbar">
        <p>只有已发布且日期不晚于今天的题目会出现在公开页面。</p>
        <label className="select-field plain-select">
          <span className="sr-only">题目状态</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as DailyProblemStatus | 'all')}
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      </div>

      {notice ? (
        <p className={`form-${noticeKind} admin-notice`} role="status">
          {notice}
        </p>
      ) : null}

      {editing !== undefined ? (
        <form className="dp-admin-editor" onSubmit={(event) => void submitProblem(event)}>
          <div className="dp-admin-editor-header">
            <div>
              <h2>{editing ? '编辑每日一题' : '新建每日一题'}</h2>
              <p>先保存草稿，确认链接和训练提示后再发布。</p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭题目编辑器"
              disabled={busy}
              onClick={closeEditor}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <div className="dp-admin-form-grid">
            <label className="dp-admin-field">
              训练日期
              <input
                type="date"
                required
                value={values.date}
                onChange={(event) =>
                  setValues((current) => ({ ...current, date: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field is-wide">
              题目标题
              <input
                maxLength={200}
                required
                value={values.title}
                onChange={(event) =>
                  setValues((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field">
              平台
              <select
                value={values.sourcePlatform}
                onChange={(event) =>
                  setValues((current) => ({ ...current, sourcePlatform: event.target.value }))
                }
              >
                {problemPlatforms.map((platform) => (
                  <option key={platform} value={platform}>
                    {platformLabels[platform]}
                  </option>
                ))}
              </select>
            </label>
            <label className="dp-admin-field">
              平台题号
              <input
                maxLength={100}
                required
                value={values.externalProblemId}
                onChange={(event) =>
                  setValues((current) => ({ ...current, externalProblemId: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field">
              难度
              <input
                maxLength={40}
                value={values.difficulty}
                onChange={(event) =>
                  setValues((current) => ({ ...current, difficulty: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field is-full">
              原题 HTTPS 链接
              <input
                type="url"
                maxLength={2_000}
                required
                value={values.sourceUrl}
                onChange={(event) =>
                  setValues((current) => ({ ...current, sourceUrl: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field is-wide">
              标签（逗号分隔）
              <input
                maxLength={492}
                value={values.tags}
                onChange={(event) =>
                  setValues((current) => ({ ...current, tags: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field">
              建议用时（分钟）
              <input
                type="number"
                min="1"
                max="600"
                value={values.estimatedMinutes}
                onChange={(event) =>
                  setValues((current) => ({ ...current, estimatedMinutes: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field is-full">
              训练提示
              <textarea
                rows={4}
                maxLength={10_000}
                required
                value={values.trainingNote}
                onChange={(event) =>
                  setValues((current) => ({ ...current, trainingNote: event.target.value }))
                }
              />
            </label>
            <label className="dp-admin-field">
              状态
              <select
                value={values.status}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    status: event.target.value as DailyProblemStatus,
                  }))
                }
              >
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="archived">已归档</option>
              </select>
            </label>
          </div>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="dp-admin-form-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={closeEditor}
            >
              取消
            </button>
            <button className="primary-button" type="submit" disabled={busy}>
              <Save size={16} aria-hidden="true" />
              {busy ? '正在保存' : '保存题目'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <LoadingState label="正在读取每日一题列表" /> : null}

      {!loading && filteredProblems.length === 0 ? (
        <EmptyState title="暂无匹配题目" description="新建题目或调整状态筛选后重试。" />
      ) : null}

      {!loading && filteredProblems.length > 0 ? (
        <div className="dp-admin-list" aria-label="每日一题列表">
          {filteredProblems.map((problem) => (
            <article className="dp-admin-item" key={problem.id}>
              <time dateTime={problem.date}>{problem.date}</time>
              <div className="dp-admin-item-title">
                <strong>{problem.title}</strong>
                <small>{problem.tags.join(' · ') || '暂无标签'}</small>
              </div>
              <div className="dp-admin-item-source">
                <span>{platformLabel(problem.sourcePlatform)}</span>
                <small>{problem.externalProblemId || '未填写题号'}</small>
              </div>
              <span className={`dp-admin-status is-${problem.status}`}>
                {statusLabels[problem.status]}
              </span>
              <div className="dp-admin-item-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`编辑题目 ${problem.title}`}
                  title="编辑题目"
                  disabled={busy}
                  onClick={() => openEditor(problem)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </button>
                {problem.status === 'published' ? (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`归档题目 ${problem.title}`}
                    title="归档题目"
                    disabled={busy}
                    onClick={() => void archiveProblem(problem)}
                  >
                    <Archive size={16} aria-hidden="true" />
                  </button>
                ) : null}
                {problem.status === 'draft' ? (
                  <button
                    className="icon-button reject-button"
                    type="button"
                    aria-label={`删除草稿 ${problem.title}`}
                    title="删除草稿"
                    disabled={busy}
                    onClick={() => void deleteDraft(problem)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
