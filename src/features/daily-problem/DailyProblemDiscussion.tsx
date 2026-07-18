import Send from 'lucide-react/dist/esm/icons/send'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import type { FormEvent } from 'react'
import type { DailyProblemComment } from '../../types/domain'
import { formatDateTime } from '../../lib/format'

interface DailyProblemDiscussionProps {
  comments: DailyProblemComment[]
  body: string
  busy: boolean
  notice: string
  canModerate: boolean
  moderationTargetId: number | null
  moderationReason: string
  onBodyChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDelete: (comment: DailyProblemComment) => void
  onStartModeration: (comment: DailyProblemComment) => void
  onCancelModeration: () => void
  onModerationReasonChange: (value: string) => void
  onConfirmModeration: (comment: DailyProblemComment) => void
}

export function DailyProblemDiscussion({
  comments,
  body,
  busy,
  notice,
  canModerate,
  moderationTargetId,
  moderationReason,
  onBodyChange,
  onSubmit,
  onDelete,
  onStartModeration,
  onCancelModeration,
  onModerationReasonChange,
  onConfirmModeration,
}: DailyProblemDiscussionProps) {
  return (
    <section className="dp-discussion" aria-labelledby="daily-problem-discussion-title">
      <div className="dp-section-heading">
        <div>
          <p>训练之后</p>
          <h2 id="daily-problem-discussion-title">交换关键思路</h2>
        </div>
        <span>
          {comments.filter((comment) => comment.visibility === 'visible').length} 条可见讨论
          {canModerate && comments.some((comment) => comment.visibility === 'hidden')
            ? ` · ${comments.filter((comment) => comment.visibility === 'hidden').length} 条已隐藏`
            : ''}
        </span>
      </div>

      <form className="dp-comment-form" onSubmit={onSubmit}>
        <label htmlFor="daily-problem-comment">写下你的突破点或易错点</label>
        <textarea
          id="daily-problem-comment"
          rows={4}
          maxLength={2_000}
          value={body}
          placeholder="只写必要的思路提示；完整代码可以留到赛后复盘。"
          disabled={busy}
          onChange={(event) => onBodyChange(event.target.value)}
        />
        <div>
          <small>{body.length}/2000 · 讨论按纯文本展示</small>
          <button className="dp-comment-submit" type="submit" disabled={busy || !body.trim()}>
            <Send size={15} aria-hidden="true" />
            {busy ? '正在发布' : '发布讨论'}
          </button>
        </div>
      </form>

      {notice ? (
        <p className="dp-inline-notice" role="status">
          {notice}
        </p>
      ) : null}

      {comments.length === 0 ? (
        <p className="dp-comments-empty">还没有讨论。完成题目后，留下第一个有用提示吧。</p>
      ) : (
        <ol className="dp-comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className={comment.visibility === 'hidden' ? 'is-hidden' : ''}>
              <div className="dp-comment-meta">
                <strong>{comment.authorLabel}</strong>
                <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
                {comment.visibility === 'hidden' ? (
                  <span className="dp-comment-visibility">已隐藏</span>
                ) : null}
                {comment.canDelete ? (
                  <button
                    type="button"
                    aria-label={`删除 ${comment.authorLabel} 的讨论`}
                    disabled={busy}
                    onClick={() => onDelete(comment)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    删除
                  </button>
                ) : null}
                {canModerate ? (
                  <button
                    className="dp-comment-moderate"
                    type="button"
                    disabled={busy}
                    onClick={() => onStartModeration(comment)}
                  >
                    {comment.visibility === 'hidden' ? '恢复' : '隐藏'}
                  </button>
                ) : null}
              </div>
              <p>{comment.body}</p>
              {canModerate && moderationTargetId === comment.id ? (
                <div className="dp-moderation-form">
                  <label htmlFor={`moderation-reason-${comment.id}`}>管理原因</label>
                  <input
                    id={`moderation-reason-${comment.id}`}
                    autoFocus
                    maxLength={500}
                    value={moderationReason}
                    placeholder={
                      comment.visibility === 'hidden'
                        ? '说明恢复原因'
                        : '说明隐藏原因（成员可联系管理员了解）'
                    }
                    onChange={(event) => onModerationReasonChange(event.target.value)}
                  />
                  <div>
                    <button type="button" disabled={busy} onClick={onCancelModeration}>
                      取消
                    </button>
                    <button
                      className="dp-moderation-confirm"
                      type="button"
                      disabled={busy || !moderationReason.trim()}
                      onClick={() => onConfirmModeration(comment)}
                    >
                      确认{comment.visibility === 'hidden' ? '恢复' : '隐藏'}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
