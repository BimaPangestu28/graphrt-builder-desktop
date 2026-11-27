import { useState } from 'react'
import { applyLessonToEveryone, decideLesson, deleteLesson, editLesson } from '@/api/learning'
import type { Lesson } from '@/api/learningTypes'
import { Badge, Button, type BadgeTone } from '@/components/ui'
import { formatDate, useT } from '@/i18n'
import { describeError } from '@/lib/agentDisplay'
import { describeLessonEvidence, describeLessonOrigin, describeLessonScope, describeRiskReason } from './lessonDisplay'

interface LessonCardProps {
  agentId: string
  lesson: Lesson
  /** Called after the note changed or was deleted, so the page reloads its lists. */
  onChanged: () => void
}

/** Which question the card is asking before it acts. */
type Pending = 'approveHighRisk' | 'delete' | 'everyone' | 'edit' | null

const trustTones: Record<Lesson['trust'], BadgeTone> = { owner: 'ok', user: 'brand', derived: 'amber' }
/** Notes longer than this are cut to three lines until "Read all". */
const longTextChars = 180
const maxLessonChars = 500

/**
 * One note: its text, who it is from and how far to trust it, why it is risky, where it came
 * from and who it applies to, then what the owner can do with it. A note nobody verified has
 * an amber edge and a high-risk one a red edge with its reasons spelled out, so neither can
 * be approved by a glance. Approving a high-risk note, deleting and widening ask once more.
 */
export function LessonCard({ agentId, lesson, onChanged }: LessonCardProps) {
  const t = useT().learning
  const [pending, setPending] = useState<Pending>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [draft, setDraft] = useState(lesson.text)
  const isHighRisk = lesson.risk === 'high'
  const isLong = lesson.text.length > longTextChars

  async function run(action: () => Promise<unknown>) {
    setIsWorking(true)
    setError(null)
    try {
      await action()
      setPending(null)
      onChanged()
    } catch (actionError) {
      setError(t.actions.couldNot(describeError(actionError)))
    } finally {
      setIsWorking(false)
    }
  }

  const approve = () => run(() => decideLesson(agentId, lesson.id, 'approve'))
  const edgeClassNames = isHighRisk ? 'border-danger-line bg-danger-tint' : lesson.trust === 'derived' ? 'border-amber-line-2 bg-amber-tint' : 'border-line bg-surface'

  return (
    <article aria-label={lesson.text} data-risk={lesson.risk} data-trust={lesson.trust} className={`flex h-full flex-col gap-3 rounded-[14px] border p-4 ${edgeClassNames}`}>
      <div className="flex flex-wrap items-center gap-2">
        {isHighRisk && <Badge tone="danger">{t.highRisk}</Badge>}
        <Badge tone={trustTones[lesson.trust]}>{t.trust[lesson.trust]}</Badge>
        <span className="min-w-0 truncate text-[12px] text-muted" title={describeLessonScope(lesson)}>
          {describeLessonScope(lesson)}
        </span>
      </div>

      {pending === 'edit' ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label={t.actions.editLabel}
            value={draft}
            maxLength={maxLessonChars}
            rows={3}
            disabled={isWorking}
            onChange={(event) => setDraft(event.target.value)}
            className="box-border w-full resize-y rounded-[9px] border border-line-strong bg-surface px-3 py-2 text-[14px] leading-normal text-ink outline-none focus:border-ink"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={isWorking || !draft.trim() || draft.trim() === lesson.text} onClick={() => void run(() => editLesson(agentId, lesson.id, draft))}>
              {t.actions.save}
            </Button>
            <Button variant="ghost" size="sm" disabled={isWorking} onClick={() => setPending(null)}>
              {t.actions.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <p className={`m-0 text-[15px] leading-normal font-medium text-ink ${isLong && !isExpanded ? 'line-clamp-3' : ''}`}>{lesson.text}</p>
          {isLong && (
            <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ink-2 underline">
              {isExpanded ? t.readLess : t.readAll}
            </button>
          )}
        </div>
      )}

      {isHighRisk && (
        <div className="flex flex-col gap-1 text-[13px] text-ink">
          <span className="font-semibold">{t.highRiskIntro}</span>
          <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
            {lesson.riskReasons.map((reason) => (
              <li key={reason.code}>{describeRiskReason(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      {lesson.trust !== 'owner' && <p className="m-0 text-[12px] leading-normal text-body">{t.trustHint[lesson.trust]}</p>}

      <div className="flex flex-col gap-0.5 text-[12px] text-muted">
        <span>{describeLessonOrigin(lesson)}</span>
        {lesson.evidence && (
          <span className="truncate" title={lesson.evidence}>
            {describeLessonEvidence(lesson)}
          </span>
        )}
        {lesson.status === 'proposed' && lesson.expiresAt && <span>{t.lapses(formatDate(new Date(lesson.expiresAt)))}</span>}
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-chip pt-3">
        {pending === 'approveHighRisk' && (
          <Confirm question={t.actions.confirmHighRisk} confirmLabel={t.actions.approveAnyway} isWorking={isWorking} onConfirm={() => void approve()} onCancel={() => setPending(null)} />
        )}
        {pending === 'delete' && (
          <Confirm question={t.actions.confirmDelete} confirmLabel={t.actions.delete} isWorking={isWorking} onConfirm={() => void run(() => deleteLesson(agentId, lesson.id))} onCancel={() => setPending(null)} />
        )}
        {pending === 'everyone' && lesson.user && (
          <Confirm
            question={t.actions.confirmEveryone(lesson.user)}
            confirmLabel={t.actions.applyToEveryone}
            isWorking={isWorking}
            onConfirm={() => void run(() => applyLessonToEveryone(agentId, lesson.id))}
            onCancel={() => setPending(null)}
          />
        )}
        {pending === null && (
          <div className="flex flex-wrap items-center gap-2">
            {lesson.status === 'proposed' && (
              <>
                <Button variant="approve" size="sm" aria-label={t.actions.approveNote(lesson.text)} disabled={isWorking} onClick={() => (isHighRisk ? setPending('approveHighRisk') : void approve())}>
                  {t.actions.approve}
                </Button>
                <Button variant="secondary" size="sm" aria-label={t.actions.rejectNote(lesson.text)} disabled={isWorking} onClick={() => void run(() => decideLesson(agentId, lesson.id, 'reject'))}>
                  {t.actions.reject}
                </Button>
              </>
            )}
            {lesson.status === 'approved' && (
              <Button variant="secondary" size="sm" aria-label={t.actions.stopUsingNote(lesson.text)} disabled={isWorking} onClick={() => void run(() => decideLesson(agentId, lesson.id, 'retire'))}>
                {t.actions.stopUsing}
              </Button>
            )}
            {lesson.status === 'retired' && (
              <Button variant="secondary" size="sm" aria-label={t.actions.useAgainNote(lesson.text)} disabled={isWorking} onClick={() => (isHighRisk ? setPending('approveHighRisk') : void approve())}>
                {t.actions.useAgain}
              </Button>
            )}
            {(lesson.status === 'proposed' || lesson.status === 'approved') && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.actions.editNote(lesson.text)}
                disabled={isWorking}
                onClick={() => {
                  setDraft(lesson.text)
                  setPending('edit')
                }}
              >
                {t.actions.edit}
              </Button>
            )}
            {lesson.user && lesson.status === 'approved' && (
              <Button variant="ghost" size="sm" aria-label={t.actions.applyToEveryoneNote(lesson.text)} disabled={isWorking} onClick={() => setPending('everyone')}>
                {t.actions.applyToEveryone}
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label={t.actions.deleteNote(lesson.text)} disabled={isWorking} className="ml-auto !text-danger" onClick={() => setPending('delete')}>
              {t.actions.delete}
            </Button>
          </div>
        )}
        {error && (
          <span role="alert" className="text-[12px] leading-normal text-danger">
            {error}
          </span>
        )}
      </div>
    </article>
  )
}

interface ConfirmProps {
  question: string
  confirmLabel: string
  isWorking: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A question asked in place of the buttons (no system dialog). */
function Confirm({ question, confirmLabel, isWorking, onConfirm, onCancel }: ConfirmProps) {
  const t = useT().learning.actions
  return (
    <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
      <span className="basis-full text-[13px] font-medium text-ink">{question}</span>
      <Button variant="danger" size="sm" disabled={isWorking} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={isWorking} onClick={onCancel}>
        {t.cancel}
      </Button>
    </div>
  )
}
