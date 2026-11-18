import { Link } from 'react-router-dom'
import { joinClassNames } from '@/components/ui'
import { chatbotToneOptions, type ChatbotKnowledgeFile, type ChatbotPersona, type HandoffRule } from '@/data/chatbotSetup'
import { routePaths } from '@/routes'
import { CheckboxRow, LabeledField, SectionHeading, fieldControlClassNames } from '../knowledge/FormControls'
import { SourceTypeTile } from '../knowledge/SourceTypeTile'

/**
 * The four sections of the chatbot setup form (screen 14): persona, knowledge,
 * channels and hand-off rules. Each is controlled by the page.
 */

const listRowClassNames = 'flex items-center gap-3 px-3.5 py-3'

export function PersonaSection({ persona, onChange }: { persona: ChatbotPersona; onChange: (persona: ChatbotPersona) => void }) {
  return (
    <section aria-labelledby="p-h" className="flex flex-col gap-3">
      <SectionHeading id="p-h">Persona</SectionHeading>
      <div className="grid grid-cols-2 gap-2.5">
        <LabeledField label="Name customers see">
          <input type="text" value={persona.displayName} onChange={(event) => onChange({ ...persona, displayName: event.target.value })} className={fieldControlClassNames} />
        </LabeledField>
        <LabeledField label="Tone">
          <select value={persona.tone} onChange={(event) => onChange({ ...persona, tone: event.target.value })} className={joinClassNames(fieldControlClassNames, 'px-2.5')}>
            {chatbotToneOptions.map((toneOption) => (
              <option key={toneOption}>{toneOption}</option>
            ))}
          </select>
        </LabeledField>
      </div>
      <LabeledField label="What it should do">
        <textarea
          rows={3}
          value={persona.instructions}
          onChange={(event) => onChange({ ...persona, instructions: event.target.value })}
          className="resize-y rounded-[10px] border border-line-strong px-3 py-2.5 text-[14px] leading-[1.55] text-ink outline-none focus:border-brand"
        />
      </LabeledField>
    </section>
  )
}

interface KnowledgeFilesSectionProps {
  knowledgeFiles: ChatbotKnowledgeFile[]
  onRemove: (fileId: string) => void
  onAddFiles: () => void
}

export function KnowledgeFilesSection({ knowledgeFiles, onRemove, onAddFiles }: KnowledgeFilesSectionProps) {
  return (
    <section aria-labelledby="k-h" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <SectionHeading id="k-h">Knowledge</SectionHeading>
        <Link to={routePaths.knowledgeDetail} className="text-[13px] font-medium">
          Catering menu and prices · Manage
        </Link>
      </div>
      {knowledgeFiles.length > 0 && (
        <ul className="m-0 list-none rounded-xl border border-line p-0">
          {knowledgeFiles.map((knowledgeFile, index) => (
            <li key={knowledgeFile.id} className={joinClassNames(listRowClassNames, index < knowledgeFiles.length - 1 && 'border-b border-chip')}>
              <SourceTypeTile type={knowledgeFile.type} />
              <span className="flex flex-auto flex-col">
                <span className="font-medium">{knowledgeFile.name}</span>
                {knowledgeFile.progress.kind === 'ready' ? (
                  <span className="text-[12px] text-muted">{knowledgeFile.progress.summary}</span>
                ) : (
                  <span className="text-[12px] text-brand-strong">Reading… {knowledgeFile.progress.percent}%</span>
                )}
              </span>
              {knowledgeFile.progress.kind === 'ready' && (
                <button
                  type="button"
                  aria-label={`Remove ${knowledgeFile.name}`}
                  onClick={() => onRemove(knowledgeFile.id)}
                  className="size-8 cursor-pointer rounded-lg border-0 bg-transparent text-muted hover:bg-chip"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAddFiles}
        className="h-12 cursor-pointer rounded-xl border border-dashed border-line-heavy bg-subtle text-[14px] font-medium text-ink-2 hover:bg-canvas"
      >
        Drop files or add a website
      </button>
    </section>
  )
}

export function ChannelsSection({ isWhatsAppEnabled, onWhatsAppChange }: { isWhatsAppEnabled: boolean; onWhatsAppChange: (isEnabled: boolean) => void }) {
  return (
    <section aria-labelledby="c-h" className="flex flex-col gap-3">
      <SectionHeading id="c-h">Where it answers</SectionHeading>
      <div className="rounded-xl border border-line">
        <label className={joinClassNames(listRowClassNames, 'cursor-pointer border-b border-chip')}>
          <span className="flex flex-auto flex-col">
            <span className="font-medium">WhatsApp</span>
            <span className="text-[12px] text-muted">+62 8•• •••• 1204 · same number as outreach</span>
          </span>
          <input type="checkbox" checked={isWhatsAppEnabled} onChange={(event) => onWhatsAppChange(event.target.checked)} className="size-[18px] accent-brand" />
        </label>
        <div className={joinClassNames(listRowClassNames, 'border-b border-chip')}>
          <span className="flex flex-auto flex-col">
            <span className="font-medium">Telegram</span>
            <span className="text-[12px] text-muted">Not connected</span>
          </span>
          <Link
            to={routePaths.connections}
            className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium no-underline !text-ink hover:bg-subtle"
          >
            Connect
          </Link>
        </div>
        <div className={listRowClassNames}>
          <span className="flex flex-auto flex-col">
            <span className="font-medium">Website chat bubble</span>
            <span className="text-[12px] text-muted">Works when graphrt runs on a server, so it answers when the Mac is off</span>
          </span>
          <span className="shrink-0 rounded-full bg-selected px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-2">Needs a server</span>
        </div>
      </div>
    </section>
  )
}

export function HandoffRulesSection({ handoffRules, onToggle }: { handoffRules: HandoffRule[]; onToggle: (ruleId: string, isEnabled: boolean) => void }) {
  return (
    <section aria-labelledby="h-h" className="flex flex-col gap-2.5">
      <SectionHeading id="h-h">Pass the chat to me when</SectionHeading>
      {handoffRules.map((rule) => (
        <CheckboxRow key={rule.id} checked={rule.isEnabled} onChange={(isEnabled) => onToggle(rule.id, isEnabled)}>
          {rule.label}
        </CheckboxRow>
      ))}
    </section>
  )
}
