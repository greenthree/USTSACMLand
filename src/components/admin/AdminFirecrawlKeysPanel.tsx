import Activity from 'lucide-react/dist/esm/icons/activity'
import KeyRound from 'lucide-react/dist/esm/icons/key-round'
import Pencil from 'lucide-react/dist/esm/icons/pencil'
import Plus from 'lucide-react/dist/esm/icons/plus'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Save from 'lucide-react/dist/esm/icons/save'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AdminFirecrawlKeyError,
  checkAdminFirecrawlKey,
  deleteAdminFirecrawlKey,
  fetchAdminFirecrawlKeys,
  upsertAdminFirecrawlKey,
} from '../../lib/adminFirecrawlKeys'
import { formatDateTime } from '../../lib/format'
import type { AdminFirecrawlKey, FirecrawlKeyHealthStatus } from '../../types/domain'
import { LoadingState } from '../LoadingState'

const conflictCodes = new Set(['config_conflict', 'conflict'])
const healthyStatuses = new Set<FirecrawlKeyHealthStatus>(['healthy', 'warning', 'critical'])
const numberFormatter = new Intl.NumberFormat('zh-CN')

const healthLabels: Record<FirecrawlKeyHealthStatus, string> = {
  unknown: '待检查',
  healthy: '正常',
  warning: '额度偏低',
  critical: '额度紧张',
  degraded: '服务异常',
  rate_limited: '暂时限流',
  auth_failed: '密钥失效',
}

function replaceKey(keys: AdminFirecrawlKey[], replacement: AdminFirecrawlKey) {
  const next = keys.filter((key) => key.id !== replacement.id)
  next.push(replacement)
  return next.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, 'zh-CN'))
}

function creditLabel(key: AdminFirecrawlKey): string {
  if (key.creditsRemaining === null || key.creditsTotal === null) return '尚未读取'
  return `${numberFormatter.format(key.creditsRemaining)} / ${numberFormatter.format(key.creditsTotal)}`
}

export function AdminFirecrawlKeysPanel() {
  const [keys, setKeys] = useState<AdminFirecrawlKey[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success')
  const [createOpen, setCreateOpen] = useState(false)
  const [createLabel, setCreateLabel] = useState('')
  const [createApiKey, setCreateApiKey] = useState('')
  const [createPriority, setCreatePriority] = useState('100')
  const [createReason, setCreateReason] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const [editPriority, setEditPriority] = useState('100')
  const [editEnabled, setEditEnabled] = useState(false)
  const [editReason, setEditReason] = useState('')

  const loadKeys = useCallback(async () => {
    setLoading(true)
    setNotice('')
    setCreateApiKey('')
    setEditApiKey('')
    try {
      setKeys(await fetchAdminFirecrawlKeys())
    } catch (error) {
      setKeys([])
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : 'Firecrawl Key 读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const editingKey = useMemo(
    () => keys.find((key) => key.id === editingId) ?? null,
    [editingId, keys],
  )

  function beginEdit(key: AdminFirecrawlKey) {
    setEditingId(key.id)
    setEditLabel(key.label)
    setEditApiKey('')
    setEditPriority(String(key.priority))
    setEditEnabled(key.enabled)
    setEditReason('')
    setNotice('')
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const label = createLabel.trim()
    const apiKey = createApiKey.trim()
    const priority = Number(createPriority)
    const reason = createReason.trim()
    if (!label || label.length > 80) return setFormError('Key 名称需包含 1 到 80 个字符。')
    if (apiKey.length < 16 || apiKey.length > 4_096 || /\s/.test(apiKey)) {
      return setFormError('API Key 需包含 16 到 4096 个非空白字符。')
    }
    if (!Number.isSafeInteger(priority) || priority < 1 || priority > 1000) {
      return setFormError('优先级需为 1 到 1000 的整数。')
    }
    if (reason.length < 3 || reason.length > 500) {
      return setFormError('修改原因需包含 3 到 500 个字符。')
    }

    setBusyKeyId('create')
    setNotice('')
    setCreateApiKey('')
    try {
      const created = await upsertAdminFirecrawlKey({
        keyId: null,
        label,
        apiKey,
        enabled: false,
        priority,
        expectedVersion: null,
        reason,
      })
      setKeys((current) => replaceKey(current, created))
      setCreateLabel('')
      setCreatePriority('100')
      setCreateReason('')
      setCreateOpen(false)
      setNoticeKind('success')
      setNotice('Key 已写入 Vault。请先执行健康检查，再启用它。')
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : 'Firecrawl Key 创建失败。')
    } finally {
      setBusyKeyId(null)
    }
  }

  function setFormError(message: string) {
    setNoticeKind('error')
    setNotice(message)
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingKey) return
    const label = editLabel.trim()
    const apiKey = editApiKey.trim()
    const priority = Number(editPriority)
    const reason = editReason.trim()
    if (!label || label.length > 80) return setFormError('Key 名称需包含 1 到 80 个字符。')
    if (apiKey && (apiKey.length < 16 || apiKey.length > 4_096 || /\s/.test(apiKey))) {
      return setFormError('替换 API Key 需包含 16 到 4096 个非空白字符。')
    }
    if (!Number.isSafeInteger(priority) || priority < 1 || priority > 1000) {
      return setFormError('优先级需为 1 到 1000 的整数。')
    }
    if (apiKey && editEnabled) return setFormError('轮换密钥时必须先停用，检查成功后再启用。')
    if (
      !editingKey.enabled &&
      editEnabled &&
      (!healthyStatuses.has(editingKey.healthStatus) ||
        editingKey.creditsRemaining === null ||
        editingKey.creditsRemaining <= 0)
    ) {
      return setFormError('只有健康检查成功的 Key 才能启用。')
    }
    if (reason.length < 3 || reason.length > 500) {
      return setFormError('修改原因需包含 3 到 500 个字符。')
    }
    const changed =
      label !== editingKey.label ||
      priority !== editingKey.priority ||
      editEnabled !== editingKey.enabled ||
      Boolean(apiKey)
    if (!changed) return setFormError('当前没有需要保存的变更。')

    setBusyKeyId(editingKey.id)
    setNotice('')
    setEditApiKey('')
    try {
      const updated = await upsertAdminFirecrawlKey({
        keyId: editingKey.id,
        label,
        ...(apiKey ? { apiKey } : {}),
        enabled: editEnabled,
        priority,
        expectedVersion: editingKey.version,
        reason,
      })
      setKeys((current) => replaceKey(current, updated))
      setEditingId(null)
      setEditReason('')
      setNoticeKind('success')
      setNotice(apiKey ? '密钥已轮换并保持停用，请检查后启用。' : 'Firecrawl Key 配置已保存。')
    } catch (error) {
      setNoticeKind('error')
      if (error instanceof AdminFirecrawlKeyError && error.code && conflictCodes.has(error.code)) {
        await loadKeys()
        setNotice(`${error.message}，已载入最新版本。`)
      } else {
        setNotice(error instanceof Error ? error.message : 'Firecrawl Key 保存失败。')
      }
    } finally {
      setBusyKeyId(null)
    }
  }

  async function checkKey(key: AdminFirecrawlKey) {
    setBusyKeyId(key.id)
    setNotice('')
    try {
      const result = await checkAdminFirecrawlKey(key.id)
      setKeys((current) => replaceKey(current, result.key))
      setNoticeKind(result.succeeded ? 'success' : 'error')
      setNotice(
        result.succeeded
          ? `${key.label} 检查成功，额度与健康状态已刷新。`
          : `${key.label} 检查失败：${result.errorCode ?? 'unknown'}。`,
      )
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : 'Firecrawl Key 检查失败。')
    } finally {
      setBusyKeyId(null)
    }
  }

  async function deleteKey() {
    if (!editingKey) return
    const reason = editReason.trim()
    if (reason.length < 3 || reason.length > 500) {
      return setFormError('删除前请填写 3 到 500 个字符的原因。')
    }
    if (!window.confirm(`确认删除“${editingKey.label}”及其 Vault 密钥？此操作不可撤销。`)) return

    setBusyKeyId(editingKey.id)
    setNotice('')
    setEditApiKey('')
    try {
      await deleteAdminFirecrawlKey(editingKey.id, editingKey.version, reason)
      setKeys((current) => current.filter((key) => key.id !== editingKey.id))
      setEditingId(null)
      setEditReason('')
      setNoticeKind('success')
      setNotice('Firecrawl Key 及其 Vault 密钥已删除。')
    } catch (error) {
      setNoticeKind('error')
      setNotice(error instanceof Error ? error.message : 'Firecrawl Key 删除失败。')
    } finally {
      setBusyKeyId(null)
    }
  }

  return (
    <section className="firecrawl-key-panel" aria-label="Firecrawl Key 管理" aria-busy={loading}>
      <header className="firecrawl-key-heading">
        <div>
          <span className="eyebrow">凭据池</span>
          <h2>Firecrawl API Key</h2>
          <p>QOJ 与牛客回退每次只领取一个 Key；失败会影响后续选择，不会在当前任务中换 Key 重试。</p>
        </div>
        <div className="firecrawl-key-heading-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={loading || busyKeyId !== null}
            onClick={() => void loadKeys()}
          >
            <RefreshCw className={loading ? 'is-spinning' : undefined} size={15} />
            刷新 Key
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setCreateOpen((open) => !open)}
          >
            <Plus size={16} />
            新增 Key
          </button>
        </div>
      </header>

      {notice ? (
        <p
          className={
            noticeKind === 'error' ? 'form-error admin-notice' : 'form-success admin-notice'
          }
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {createOpen ? (
        <form className="firecrawl-key-form" onSubmit={createKey}>
          <div className="form-grid">
            <label>
              <span>Key 名称</span>
              <input
                required
                maxLength={80}
                placeholder="例如：主额度池"
                value={createLabel}
                disabled={busyKeyId !== null}
                onChange={(event) => setCreateLabel(event.target.value)}
              />
            </label>
            <label>
              <span>优先级</span>
              <input
                required
                type="number"
                min={1}
                max={1000}
                value={createPriority}
                disabled={busyKeyId !== null}
                onChange={(event) => setCreatePriority(event.target.value)}
              />
              <small>数值越小越优先；同优先级按最久未使用轮转。</small>
            </label>
            <label className="span-two">
              <span>API Key</span>
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={4096}
                value={createApiKey}
                disabled={busyKeyId !== null}
                spellCheck={false}
                onChange={(event) => setCreateApiKey(event.target.value)}
              />
              <small>只写入 Supabase Vault，提交后立即清空且永不回显。</small>
            </label>
            <label className="span-two">
              <span>创建原因</span>
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={createReason}
                disabled={busyKeyId !== null}
                onChange={(event) => setCreateReason(event.target.value)}
              />
            </label>
          </div>
          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={busyKeyId !== null}>
              <Save size={16} />
              {busyKeyId === 'create' ? '写入中' : '写入 Vault'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <LoadingState label="正在读取 Firecrawl Key" /> : null}

      {!loading && keys.length === 0 ? (
        <div className="firecrawl-key-empty">
          <KeyRound size={24} aria-hidden="true" />
          <div>
            <strong>尚未配置数据库 Key</strong>
            <p>在此添加首个 Key 前，服务端仍兼容现有 FIRECRAWL_API_KEY Secret。</p>
          </div>
        </div>
      ) : null}

      {!loading && keys.length > 0 ? (
        <div className="firecrawl-key-list">
          {keys.map((key) => (
            <article key={key.id} className="firecrawl-key-card">
              <header>
                <div>
                  <strong>{key.label}</strong>
                  <span className={`health-level health-level-${key.healthStatus}`}>
                    {healthLabels[key.healthStatus]}
                  </span>
                  <span className={key.enabled ? 'status status-verified' : 'status status-muted'}>
                    {key.enabled ? '已启用' : '已停用'}
                  </span>
                </div>
                <div className="firecrawl-key-card-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyKeyId !== null}
                    onClick={() => void checkKey(key)}
                  >
                    <Activity size={15} />
                    {busyKeyId === key.id ? '检查中' : '检查'}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busyKeyId !== null}
                    onClick={() => beginEdit(key)}
                  >
                    <Pencil size={15} />
                    编辑
                  </button>
                </div>
              </header>
              <dl>
                <div>
                  <dt>密钥</dt>
                  <dd>{key.keyConfigured ? 'Vault 已配置' : 'Vault 缺失'}</dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{key.priority}</dd>
                </div>
                <div>
                  <dt>剩余额度</dt>
                  <dd>{creditLabel(key)}</dd>
                </div>
                <div>
                  <dt>连续失败</dt>
                  <dd>{key.consecutiveFailures}</dd>
                </div>
                <div>
                  <dt>最近检查</dt>
                  <dd>{formatDateTime(key.lastCheckedAt)}</dd>
                </div>
                <div>
                  <dt>最近使用</dt>
                  <dd>{formatDateTime(key.lastSelectedAt)}</dd>
                </div>
              </dl>
              {key.lastErrorCode ? (
                <p className="firecrawl-key-error">
                  最近错误：<code>{key.lastErrorCode}</code>
                </p>
              ) : null}
              {key.cooldownUntil ? <p>冷却至：{formatDateTime(key.cooldownUntil)}</p> : null}
            </article>
          ))}
        </div>
      ) : null}

      {editingKey ? (
        <form className="firecrawl-key-form firecrawl-key-edit-form" onSubmit={saveEdit}>
          <header>
            <div>
              <span className="eyebrow">编辑与轮换</span>
              <h3>{editingKey.label}</h3>
            </div>
            <button className="text-button" type="button" onClick={() => setEditingId(null)}>
              取消
            </button>
          </header>
          <div className="form-grid">
            <label>
              <span>Key 名称</span>
              <input
                value={editLabel}
                maxLength={80}
                onChange={(event) => setEditLabel(event.target.value)}
              />
            </label>
            <label>
              <span>优先级</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={editPriority}
                onChange={(event) => setEditPriority(event.target.value)}
              />
            </label>
            <label className="span-two firecrawl-key-toggle">
              <input
                type="checkbox"
                checked={editEnabled}
                disabled={
                  !editingKey.enabled &&
                  (!healthyStatuses.has(editingKey.healthStatus) ||
                    editingKey.creditsRemaining === null ||
                    editingKey.creditsRemaining <= 0)
                }
                onChange={(event) => setEditEnabled(event.target.checked)}
              />
              <span>
                <strong>允许运行时选择此 Key</strong>
                <small>新建或轮换后的 Key 必须先通过检查才能启用。</small>
              </span>
            </label>
            <label className="span-two">
              <span>替换 API Key（可选）</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={4096}
                value={editApiKey}
                spellCheck={false}
                onChange={(event) => {
                  setEditApiKey(event.target.value)
                  if (event.target.value) setEditEnabled(false)
                }}
              />
              <small>填写即原位轮换 Vault 密钥，并重置健康状态；旧密钥不会回显。</small>
            </label>
            <label className="span-two">
              <span>修改或删除原因</span>
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
              />
            </label>
          </div>
          <div className="form-actions firecrawl-key-edit-actions">
            <button
              className="danger-button"
              type="button"
              disabled={busyKeyId !== null}
              onClick={() => void deleteKey()}
            >
              <Trash2 size={16} />
              删除 Key
            </button>
            <button className="primary-button" type="submit" disabled={busyKeyId !== null}>
              <Save size={16} />
              保存配置
            </button>
          </div>
        </form>
      ) : null}

      <div className="firecrawl-key-security-note">
        <KeyRound size={18} aria-hidden="true" />
        <p>
          浏览器只接收 Key 名称、状态和额度，不会获得 API Key、Vault Secret
          ID、成员信息或第三方响应正文。
        </p>
      </div>
    </section>
  )
}
