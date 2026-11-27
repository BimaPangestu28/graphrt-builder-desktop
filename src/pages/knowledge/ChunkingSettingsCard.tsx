import { useEffect, useState } from 'react'
import type { ChunkingSettings, SeparatorKind, SeparatorSetting } from '@/api/knowledgeTypes'
import { joinClassNames } from '@/components/ui'
import { CheckboxRow, compactButtonClassNames, fieldControlClassNames } from './FormControls'
import {
  MAX_MAX_TOKENS,
  MAX_SEPARATORS,
  MIN_MAX_TOKENS,
  PRESET_SEPARATOR_KINDS,
  chunkingProblem,
  chunkingSettingsEqual,
  defaultChunkingSettings,
} from './chunkingSettings'
import { useT } from '@/i18n'

type Messages = ReturnType<typeof useT>['knowledgeIndexing']

/** What a separator chip says. */
export function separatorLabel(separator: SeparatorSetting, t: Messages): string {
  switch (separator.kind) {
    case 'paragraph':
      return t.separatorParagraph
    case 'line':
      return t.separatorLine
    case 'sentence':
      return t.separatorSentence
    case 'clause':
      return t.separatorClause
    case 'word':
      return t.separatorWord
    case 'text':
      return t.separatorText(separator.value)
    case 'pattern':
      return t.separatorPattern(separator.value)
  }
}

type AddChoice = SeparatorKind

/** The ordered separator list: move up or down, remove, add a preset or a custom one. */
function SeparatorListEditor({ separators, onChange }: { separators: SeparatorSetting[]; onChange: (separators: SeparatorSetting[]) => void }) {
  const t = useT().knowledgeIndexing
  const unusedPresets = PRESET_SEPARATOR_KINDS.filter((kind) => !separators.some((separator) => separator.kind === kind))
  const [choice, setChoice] = useState<AddChoice>(unusedPresets[0] ?? 'text')
  const [customValue, setCustomValue] = useState('')
  const needsValue = choice === 'text' || choice === 'pattern'
  const isFull = separators.length >= MAX_SEPARATORS
  const isPresetUsed = !needsValue && separators.some((separator) => separator.kind === choice)

  const move = (index: number, by: -1 | 1) => {
    const target = index + by
    if (target < 0 || target >= separators.length) return
    const next = [...separators]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    onChange(next)
  }
  const add = () => {
    if (choice === 'text' || choice === 'pattern') {
      if (customValue === '') return
      onChange([...separators, { kind: choice, value: customValue }])
      setCustomValue('')
      return
    }
    onChange([...separators, { kind: choice }])
    const remaining = unusedPresets.filter((kind) => kind !== choice)
    setChoice(remaining[0] ?? 'text')
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {separators.map((separator, index) => {
          const label = separatorLabel(separator, t)
          return (
            <li key={`${separator.kind}-${'value' in separator ? separator.value : ''}-${index}`} className="flex min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
              <span className="w-5 shrink-0 text-[12px] font-semibold text-muted">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-[13px]" title={label}>
                {label}
              </span>
              <button type="button" aria-label={t.moveUp(label)} disabled={index === 0} onClick={() => move(index, -1)} className="size-7 cursor-pointer rounded-md border border-line bg-surface text-ink-2 disabled:cursor-default disabled:opacity-40">
                ↑
              </button>
              <button type="button" aria-label={t.moveDown(label)} disabled={index === separators.length - 1} onClick={() => move(index, 1)} className="size-7 cursor-pointer rounded-md border border-line bg-surface text-ink-2 disabled:cursor-default disabled:opacity-40">
                ↓
              </button>
              <button type="button" aria-label={t.removeSeparator(label)} onClick={() => onChange(separators.filter((_, position) => position !== index))} className="size-7 cursor-pointer rounded-md border border-line bg-surface text-danger">
                ×
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-start gap-2">
        <select aria-label={t.addSeparatorLabel} value={choice} onChange={(event) => setChoice(event.target.value as AddChoice)} className={joinClassNames(fieldControlClassNames, 'min-w-0 flex-[1_1_200px]')}>
          {unusedPresets.map((kind) => (
            <option key={kind} value={kind}>
              {separatorLabel({ kind }, t)}
            </option>
          ))}
          <option value="text">{t.customTextOption}</option>
          <option value="pattern">{t.customPatternOption}</option>
        </select>
        {needsValue && (
          <input
            type="text"
            aria-label={t.customValueLabel}
            value={customValue}
            maxLength={100}
            placeholder={choice === 'pattern' ? t.customPatternPlaceholder : t.customTextPlaceholder}
            onChange={(event) => setCustomValue(event.target.value)}
            className={joinClassNames(fieldControlClassNames, 'min-w-0 flex-[1_1_200px] font-mono text-[13px]')}
          />
        )}
        <button type="button" disabled={isFull || isPresetUsed || (needsValue && customValue === '')} onClick={add} className={compactButtonClassNames('secondary', 'h-10')}>
          {t.addSeparator}
        </button>
      </div>
      {needsValue && <p className="m-0 text-[12px] text-muted">{choice === 'pattern' ? t.customPatternHint : t.customTextHint}</p>}
    </div>
  )
}

/** A number field with its label and a one-line hint underneath. */
function TokenField({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Math.round(Number(event.target.value)))}
        className={fieldControlClassNames}
      />
      <span className="text-[12px] leading-snug text-muted">{hint}</span>
    </label>
  )
}

interface ChunkingSettingsCardProps {
  chunking: ChunkingSettings
  /** Resolves true when saved; failures are shown by the page. */
  onSave: (chunking: ChunkingSettings) => Promise<boolean>
}

/**
 * "Advanced settings" of screen 18: how documents are cut into passages. Collapsed until opened,
 * edited as a draft and saved together; saving never re-indexes by itself (the banner above offers it).
 */
export function ChunkingSettingsCard({ chunking, onSave }: ChunkingSettingsCardProps) {
  const t = useT().knowledgeIndexing
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState(chunking)
  const [isSaving, setIsSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  // Reset the draft only when the saved settings really change, not on every reload of the page.
  const savedKey = JSON.stringify(chunking)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(chunking), [savedKey])
  const isChanged = !chunkingSettingsEqual(draft, chunking)
  const isCustomized = !chunkingSettingsEqual(chunking, defaultChunkingSettings())
  const isDraftDefault = chunkingSettingsEqual(draft, defaultChunkingSettings())
  const problem = chunkingProblem(draft)
  const update = (changes: Partial<ChunkingSettings>) => {
    setJustSaved(false)
    setDraft((current) => ({ ...current, ...changes }))
  }
  const save = async () => {
    setIsSaving(true)
    try {
      setJustSaved(await onSave(draft))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section aria-labelledby="chunking-h" className="flex flex-col rounded-2xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="chunking-body"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border-0 bg-transparent px-5 py-4 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id="chunking-h" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {t.advancedSettings}
            {isCustomized && <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-strong">{t.customized}</span>}
          </span>
          <span className="text-[13px] text-muted">{t.advancedSettingsHint}</span>
        </span>
        <span aria-hidden="true" className={joinClassNames('text-[18px] text-muted transition-transform', isOpen && 'rotate-180')}>
          ⌄
        </span>
      </button>
      {isOpen && (
        <div id="chunking-body" className="flex flex-col gap-5 border-t border-line px-5 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TokenField label={t.maxTokens} hint={t.maxTokensHint} value={draft.maxTokens} min={MIN_MAX_TOKENS} max={MAX_MAX_TOKENS} onChange={(maxTokens) => update({ maxTokens })} />
            <TokenField label={t.overlapTokens} hint={t.overlapTokensHint} value={draft.overlapTokens} min={0} max={Math.floor(draft.maxTokens / 2) || 0} onChange={(overlapTokens) => update({ overlapTokens })} />
            <TokenField label={t.minTokens} hint={t.minTokensHint} value={draft.minTokens} min={0} max={draft.maxTokens || 0} onChange={(minTokens) => update({ minTokens })} />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-ink-2">{t.separators}</span>
              <span className="text-[12px] leading-snug text-muted">{t.separatorsHint}</span>
              <SeparatorListEditor separators={draft.separators} onChange={(separators) => update({ separators })} />
            </div>
            <div className="flex min-w-0 flex-col gap-3 pt-6">
              <CheckboxRow checked={draft.respectHeadings} onChange={(respectHeadings) => update({ respectHeadings })}>
                <span className="text-[13px]">{t.respectHeadings}</span>
              </CheckboxRow>
              <CheckboxRow checked={draft.splitPages} onChange={(splitPages) => update({ splitPages })}>
                <span className="text-[13px]">{t.splitPages}</span>
              </CheckboxRow>
            </div>
          </div>
          {problem && (
            <p role="alert" className="m-0 rounded-[10px] border border-amber-line bg-amber-tint px-3.5 py-2.5 text-[13px] text-amber-deep">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!isChanged || problem !== null || isSaving} onClick={() => void save()} className={compactButtonClassNames('primary')}>
              {isSaving ? t.saving : t.save}
            </button>
            {isChanged && (
              <button type="button" onClick={() => setDraft(chunking)} className={compactButtonClassNames('secondary')}>
                {t.discard}
              </button>
            )}
            <button type="button" disabled={isDraftDefault} onClick={() => update(defaultChunkingSettings())} className={compactButtonClassNames('secondary', 'ml-auto')}>
              {t.resetDefaults}
            </button>
            {justSaved && !isChanged && <span className="w-full text-[12px] text-brand-strong" aria-live="polite">{t.saved}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
