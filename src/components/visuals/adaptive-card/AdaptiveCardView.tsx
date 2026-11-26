import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { openCardLink } from '@/api/runSummary'
import { describeError } from '@/lib/agentDisplay'
import { messages } from '@/i18n'
import type { AdaptiveCard, AdaptiveCardBlock, CardNode } from '../uiBlockTypes'
import {
  actionKey,
  buildSubmissionValues,
  collectInputs,
  initialCardValues,
  knownTypes,
  missingRequiredInputs,
  resolveAnswerAction,
  toggleValues,
  type CardValues,
} from './cardModel'
import { isSafeCardLink, parseCardMarkdown, type InlineToken } from './inlineMarkdown'

/**
 * Renders an `adaptive_card` block with the app's own components and theme tokens (no Adaptive Cards SDK,
 * no HTML parsing): text, facts, columns, tables, data: images, inputs and actions. Card colours and sizes
 * map to the app's palette, so cards look like the rest of graphrt. Text wraps by default: business users
 * read whole sentences, not clipped lines.
 *
 * Buttons: Action.Submit / Action.Execute answer a paused step when `onSubmit` is given and the button maps
 * to one of `answerActionIds` (see `resolveAnswerAction`); elsewhere they are shown disabled with a hint.
 * Action.OpenUrl opens https / mailto links in the browser through the backend; Action.ShowCard and
 * Action.ToggleVisibility work locally. Remote images are never fetched (the app's CSP forbids them too).
 */

export interface CardSubmission {
  action: string
  values: Record<string, unknown>
}

interface AdaptiveCardViewProps {
  block: AdaptiveCardBlock
  /** Answers the paused step; without it buttons are disabled. */
  onSubmit?: (submission: CardSubmission) => void
  /** The paused step's action ids. */
  answerActionIds?: string[]
  /** True while an answer is being sent. */
  isSubmitting?: boolean
}

interface CardContextValue {
  values: CardValues
  setValue: (id: string, value: string) => void
  hidden: Record<string, boolean>
  toggle: (targets: unknown) => void
  runAction: (action: CardNode) => void
  canSubmit: (action: CardNode) => boolean
  submitHint: string | null
  isSubmitting: boolean
}

const CardContext = createContext<CardContextValue | null>(null)

function useCard(): CardContextValue {
  const context = useContext(CardContext)
  if (!context) throw new Error('Adaptive Card elements must be rendered inside AdaptiveCardView')
  return context
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const lower = (value: unknown): string => (typeof value === 'string' ? value.toLowerCase() : '')

// --- Theme mapping -------------------------------------------------------------------------------------------

const textSizes: Record<string, string> = { small: 'text-[12px]', default: 'text-[14px]', medium: 'text-[16px]', large: 'text-[20px]', extralarge: 'text-[26px]' }
const textWeights: Record<string, string> = { lighter: 'font-normal', default: 'font-normal', bolder: 'font-semibold' }
const textColors: Record<string, string> = {
  default: 'text-ink',
  dark: 'text-ink',
  light: 'text-muted',
  accent: 'text-brand',
  good: 'text-ok-strong',
  warning: 'text-amber-strong',
  attention: 'text-danger',
}
const containerStyles: Record<string, string> = {
  default: '',
  emphasis: 'bg-subtle rounded-[10px] p-3',
  accent: 'bg-brand-tint rounded-[10px] p-3',
  good: 'bg-ok-tint rounded-[10px] p-3',
  attention: 'bg-danger-tint rounded-[10px] p-3',
  warning: 'bg-amber-tint rounded-[10px] p-3',
}
const spacingPixels: Record<string, number> = { none: 0, small: 4, default: 8, medium: 16, large: 24, extralarge: 32, padding: 16 }
const imageSizes: Record<string, number> = { small: 40, medium: 80, large: 160 }
const alignments: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }
const selfAlignments: Record<string, string> = { left: 'self-start', center: 'self-center', right: 'self-end' }

function textClassNames(node: CardNode): string {
  const heading = lower(node.style) === 'heading'
  return [
    textSizes[lower(node.size) || (heading ? 'medium' : 'default')] ?? textSizes.default,
    textWeights[lower(node.weight) || (heading ? 'bolder' : 'default')] ?? '',
    node.isSubtle === true ? 'text-muted' : (textColors[lower(node.color) || 'default'] ?? 'text-ink'),
    alignments[lower(node.horizontalAlignment)] ?? '',
    lower(node.fontType) === 'monospace' ? 'font-mono' : '',
  ].join(' ')
}

// --- Text ------------------------------------------------------------------------------------------------------

function CardLink({ url, children }: { url: string; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null)
  if (!isSafeCardLink(url)) return <>{children}</>
  return (
    <>
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault()
          setError(null)
          openCardLink(url).catch((openError: unknown) => setError(messages().visuals.couldNotOpenLink(describeError(openError))))
        }}
      >
        {children}
      </a>
      {error && <span role="alert" className="ml-1 text-[12px] text-danger">{error}</span>}
    </>
  )
}

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        const content = token.bold ? <strong className="font-semibold">{token.text}</strong> : token.text
        const styled = token.italic ? <em>{content}</em> : content
        return token.kind === 'link' ? (
          <CardLink key={index} url={token.url}>{styled}</CardLink>
        ) : (
          <span key={index}>{styled}</span>
        )
      })}
    </>
  )
}

function MarkdownText({ text, className, maxLines }: { text: string; className: string; maxLines?: number }) {
  const parts = useMemo(() => parseCardMarkdown(text), [text])
  const clamp: CSSProperties | undefined =
    maxLines && maxLines > 0 ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined
  return (
    <div className={`${className} leading-snug [overflow-wrap:anywhere]`} style={clamp}>
      {parts.map((part, index) => {
        if (part.kind === 'paragraph') return <p key={index} className="m-0 min-h-[1em]"><Inline tokens={part.tokens} /></p>
        const items = part.items.map((tokens, itemIndex) => <li key={itemIndex}><Inline tokens={tokens} /></li>)
        return part.kind === 'bullets' ? (
          <ul key={index} className="my-1 list-disc pl-5">{items}</ul>
        ) : (
          <ol key={index} start={part.start} className="my-1 list-decimal pl-5">{items}</ol>
        )
      })}
    </div>
  )
}

function TextBlock({ node }: { node: CardNode }) {
  const maxLines = typeof node.maxLines === 'number' ? node.maxLines : undefined
  const role = lower(node.style) === 'heading' ? 'heading' : undefined
  return (
    <div role={role} aria-level={role ? 3 : undefined}>
      <MarkdownText text={str(node.text) ?? ''} className={textClassNames(node)} maxLines={maxLines} />
    </div>
  )
}

function RichTextBlock({ node }: { node: CardNode }) {
  const inlines = Array.isArray(node.inlines) ? node.inlines : []
  return (
    <p className={`m-0 leading-snug [overflow-wrap:anywhere] ${alignments[lower(node.horizontalAlignment)] ?? ''}`}>
      {inlines.map((inline, index) => {
        if (typeof inline === 'string') return <span key={index}>{inline}</span>
        const run = inline as CardNode
        const classNames = [
          textClassNames(run),
          run.italic === true ? 'italic' : '',
          run.strikethrough === true ? 'line-through' : '',
          run.underline === true ? 'underline' : '',
          run.highlight === true ? 'bg-amber-soft' : '',
        ].join(' ')
        const content = <span key={index} className={classNames}>{str(run.text)}</span>
        const action = run.selectAction as CardNode | undefined
        return action && lower(action.type) === 'action.openurl' && typeof action.url === 'string' ? <CardLink key={index} url={action.url}>{content}</CardLink> : content
      })}
    </p>
  )
}

// --- Images --------------------------------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

function CardImage({ node, sizeOverride }: { node: CardNode; sizeOverride?: string }) {
  const url = str(node.url) ?? ''
  const size = lower(sizeOverride ?? node.size)
  const pixels = imageSizes[size]
  const explicitWidth = str(node.width)?.endsWith('px') ? Number.parseInt(str(node.width) ?? '', 10) : undefined
  const style: CSSProperties = { width: explicitWidth ?? (pixels ? pixels : size === 'stretch' ? '100%' : undefined), maxWidth: '100%', height: 'auto' }
  const rounded = lower(node.style) === 'person' ? 'rounded-full' : 'rounded-[8px]'
  const align = selfAlignments[lower(node.horizontalAlignment)] ?? 'self-start'
  if (!url.toLowerCase().startsWith('data:image/')) {
    return (
      <span className={`${align} inline-flex items-center gap-1.5 rounded-[8px] border border-dashed border-line-heavy bg-subtle px-2.5 py-1.5 text-[12px] text-muted`}>
        {str(node.altText) ? `${str(node.altText)} · ` : ''}
        {messages().visuals.imageNotLoaded(hostOf(url))}
      </span>
    )
  }
  return <img src={url} alt={str(node.altText) ?? ''} style={style} className={`${align} ${rounded} object-contain`} />
}

// --- Layout --------------------------------------------------------------------------------------------------

function Elements({ nodes }: { nodes: unknown }) {
  const list = Array.isArray(nodes) ? (nodes as CardNode[]) : []
  return (
    <>
      {list.map((node, index) => (
        <Element key={str(node.id) ?? index} node={node} isFirst={index === 0} />
      ))}
    </>
  )
}

function Container({ node, children }: { node: CardNode; children: ReactNode }) {
  const vertical = lower(node.verticalContentAlignment)
  return (
    <div className={`flex flex-col ${containerStyles[lower(node.style)] ?? ''} ${vertical === 'center' ? 'justify-center' : vertical === 'bottom' ? 'justify-end' : ''}`} style={{ minHeight: str(node.minHeight) }}>
      {children}
    </div>
  )
}

function columnStyle(width: unknown): CSSProperties {
  if (typeof width === 'number') return { flex: `${width} 1 0`, minWidth: 140 }
  const value = lower(width)
  if (value === 'auto') return { flex: '0 0 auto' }
  if (value.endsWith('px')) return { flex: `0 0 ${Number.parseInt(value, 10)}px` }
  const weight = Number(value)
  if (value !== '' && Number.isFinite(weight)) return { flex: `${weight} 1 0`, minWidth: 140 }
  return { flex: '1 1 0', minWidth: 140 }
}

function ColumnSet({ node }: { node: CardNode }) {
  const columns = Array.isArray(node.columns) ? (node.columns as CardNode[]) : []
  return (
    <div className={`flex flex-wrap gap-4 ${containerStyles[lower(node.style)] ?? ''}`}>
      {columns.map((column, index) => {
        if (column.isVisible === false) return null
        return (
          <div key={str(column.id) ?? index} style={columnStyle(column.width)} className="min-w-0">
            <Container node={column}>
              <Elements nodes={column.items} />
            </Container>
          </div>
        )
      })}
    </div>
  )
}

function FactSet({ node }: { node: CardNode }) {
  const facts = Array.isArray(node.facts) ? (node.facts as CardNode[]) : []
  return (
    <dl className="m-0 grid gap-x-6 gap-y-1.5" style={{ gridTemplateColumns: 'minmax(96px, max-content) minmax(0, 1fr)' }}>
      {facts.map((fact, index) => (
        <div key={index} className="contents">
          <dt className="text-[13px] font-medium text-muted">{str(fact.title)}</dt>
          <dd className="m-0 text-[14px] text-ink">
            <MarkdownText text={str(fact.value) ?? ''} className="" />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function CardTable({ node }: { node: CardNode }) {
  const rows = Array.isArray(node.rows) ? (node.rows as CardNode[]) : []
  const columns = Array.isArray(node.columns) ? (node.columns as CardNode[]) : []
  const headerFirst = node.firstRowAsHeader !== false
  const grid = node.showGridLines !== false
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} style={{ width: typeof column.width === 'number' ? `${column.width * 10}%` : str(column.width) }} />
          ))}
        </colgroup>
        <tbody>
          {rows.map((row, rowIndex) => {
            const isHeader = headerFirst && rowIndex === 0
            const cells = Array.isArray(row.cells) ? (row.cells as CardNode[]) : []
            return (
              <tr key={rowIndex} className={`${isHeader ? 'bg-subtle' : ''} ${grid ? 'border-b border-line last:border-b-0' : ''}`}>
                {cells.map((cell, cellIndex) => {
                  const Cell = isHeader ? 'th' : 'td'
                  return (
                    <Cell key={cellIndex} scope={isHeader ? 'col' : undefined} className={`px-3 py-2 text-left align-top ${isHeader ? 'font-medium text-muted' : ''}`}>
                      <div className="flex flex-col gap-1">
                        <Elements nodes={cell.items} />
                      </div>
                    </Cell>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Inputs --------------------------------------------------------------------------------------------------

const fieldClassNames =
  'box-border h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft disabled:opacity-60'

function InputLabel({ node, htmlFor }: { node: CardNode; htmlFor: string }) {
  const label = str(node.label)
  if (!label) return null
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
      {label}
      {node.isRequired === true && <span className="text-danger"> *</span>}
    </label>
  )
}

function CardInputField({ node }: { node: CardNode }) {
  const { values, setValue, isSubmitting } = useCard()
  const id = str(node.id) ?? ''
  const domId = `card-input-${id}`
  const value = values[id] ?? ''
  const placeholder = str(node.placeholder)
  const common = { id: domId, disabled: isSubmitting, 'aria-required': node.isRequired === true || undefined }
  let control: ReactNode
  switch (node.type) {
    case 'Input.Text':
      control =
        node.isMultiline === true ? (
          <textarea {...common} rows={3} value={value} placeholder={placeholder} maxLength={typeof node.maxLength === 'number' ? node.maxLength : undefined} onChange={(event) => setValue(id, event.target.value)} className={`${fieldClassNames} h-auto py-2`} />
        ) : (
          <input {...common} type="text" value={value} placeholder={placeholder} maxLength={typeof node.maxLength === 'number' ? node.maxLength : undefined} onChange={(event) => setValue(id, event.target.value)} className={fieldClassNames} />
        )
      break
    case 'Input.Number':
      control = <input {...common} type="number" value={value} placeholder={placeholder} min={typeof node.min === 'number' ? node.min : undefined} max={typeof node.max === 'number' ? node.max : undefined} onChange={(event) => setValue(id, event.target.value)} className={`${fieldClassNames} tabular-nums`} />
      break
    case 'Input.Date':
      control = <input {...common} type="date" value={value} min={str(node.min)} max={str(node.max)} onChange={(event) => setValue(id, event.target.value)} className={fieldClassNames} />
      break
    case 'Input.Time':
      control = <input {...common} type="time" value={value} min={str(node.min)} max={str(node.max)} onChange={(event) => setValue(id, event.target.value)} className={fieldClassNames} />
      break
    case 'Input.Toggle': {
      const { on, off } = toggleValues(node)
      return (
        <label className="flex cursor-pointer items-start gap-2.5 text-[14px] text-ink">
          <input {...common} type="checkbox" checked={value === on} onChange={(event) => setValue(id, event.target.checked ? on : off)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" />
          <span>{str(node.title) ?? str(node.label)}</span>
        </label>
      )
    }
    case 'Input.ChoiceSet': {
      const choices = Array.isArray(node.choices) ? (node.choices as CardNode[]) : []
      const multi = node.isMultiSelect === true
      const selected = new Set(value ? value.split(',') : [])
      if (multi || lower(node.style) === 'expanded') {
        control = (
          <div role={multi ? 'group' : 'radiogroup'} aria-labelledby={`${domId}-label`} className="flex flex-col gap-1.5">
            {choices.map((choice) => {
              const choiceValue = str(choice.value) ?? ''
              return (
                <label key={choiceValue} className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name={domId}
                    disabled={isSubmitting}
                    checked={selected.has(choiceValue)}
                    onChange={(event) => {
                      if (!multi) return setValue(id, choiceValue)
                      const next = new Set(selected)
                      if (event.target.checked) next.add(choiceValue)
                      else next.delete(choiceValue)
                      setValue(id, choices.map((c) => str(c.value) ?? '').filter((v) => next.has(v)).join(','))
                    }}
                    className="h-4 w-4 accent-[var(--color-brand)]"
                  />
                  {str(choice.title)}
                </label>
              )
            })}
          </div>
        )
      } else {
        control = (
          <select {...common} value={value} onChange={(event) => setValue(id, event.target.value)} className={fieldClassNames}>
            {(value === '' || placeholder) && <option value="">{placeholder ?? messages().visuals.selectPlaceholder}</option>}
            {choices.map((choice) => (
              <option key={str(choice.value)} value={str(choice.value)}>{str(choice.title)}</option>
            ))}
          </select>
        )
      }
      break
    }
    default:
      return null
  }
  return (
    <div className="flex flex-col gap-1.5" id={`${domId}-label`}>
      <InputLabel node={node} htmlFor={domId} />
      {control}
    </div>
  )
}

// --- Actions -------------------------------------------------------------------------------------------------

const buttonBase = 'inline-flex h-10 max-w-full items-center justify-center rounded-[10px] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50'
const buttonStyles: Record<string, string> = {
  positive: `${buttonBase} cursor-pointer border-0 bg-ink text-white hover:bg-ink-2`,
  destructive: `${buttonBase} cursor-pointer border border-danger-line bg-surface text-danger hover:bg-danger-tint`,
  default: `${buttonBase} cursor-pointer border border-line-strong bg-surface font-medium text-ink hover:bg-subtle`,
}

function ActionButtons({ actions, isPrimaryRow }: { actions: unknown; isPrimaryRow: boolean }) {
  const card = useCard()
  const [shownCard, setShownCard] = useState<number | null>(null)
  const list = Array.isArray(actions) ? (actions as CardNode[]) : []
  if (list.length === 0) return null
  const nested = shownCard !== null ? (list[shownCard]?.card as AdaptiveCard | undefined) : undefined
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((action, index) => {
          const isSubmit = action.type === 'Action.Submit' || action.type === 'Action.Execute'
          const style = lower(action.style) || (isPrimaryRow && index === 0 && isSubmit ? 'positive' : 'default')
          const disabled = action.isEnabled === false || (isSubmit && !card.canSubmit(action)) || card.isSubmitting
          const title = str(action.title) ?? str(action.id) ?? ''
          const hint = isSubmit && !card.canSubmit(action) ? (card.submitHint ?? undefined) : str(action.tooltip)
          return (
            <button
              key={str(action.id) ?? index}
              type="button"
              disabled={disabled}
              title={hint}
              aria-expanded={action.type === 'Action.ShowCard' ? shownCard === index : undefined}
              onClick={() => (action.type === 'Action.ShowCard' ? setShownCard((current) => (current === index ? null : index)) : card.runAction(action))}
              className={buttonStyles[style] ?? buttonStyles.default}
            >
              <span className="truncate">{title}</span>
              {action.type === 'Action.OpenUrl' && <span aria-hidden="true" className="ml-1.5 text-[12px] opacity-70">↗</span>}
              {action.type === 'Action.ShowCard' && <span aria-hidden="true" className="ml-1.5 text-[12px]">{shownCard === index ? '▴' : '▾'}</span>}
            </button>
          )
        })}
      </div>
      {nested && (
        <div className="rounded-[10px] border border-line bg-subtle p-3">
          <CardBody card={nested} />
        </div>
      )}
      {isPrimaryRow && card.submitHint && list.some((action) => (action.type === 'Action.Submit' || action.type === 'Action.Execute') && !card.canSubmit(action)) && (
        <span className="text-[12px] text-muted">{card.submitHint}</span>
      )}
    </div>
  )
}

// --- Elements ------------------------------------------------------------------------------------------------

function Selectable({ node, children }: { node: CardNode; children: ReactNode }) {
  const { runAction } = useCard()
  const action = node.selectAction as CardNode | undefined
  if (!action || action.type === 'Action.Submit' || action.type === 'Action.Execute') return <>{children}</>
  return (
    <div role="button" tabIndex={0} onClick={() => runAction(action)} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && runAction(action)} className="cursor-pointer rounded-[10px] hover:bg-subtle">
      {children}
    </div>
  )
}

function ElementContent({ node }: { node: CardNode }) {
  switch (node.type) {
    case 'TextBlock':
      return <TextBlock node={node} />
    case 'RichTextBlock':
      return <RichTextBlock node={node} />
    case 'Image':
      return <CardImage node={node} />
    case 'ImageSet':
      return (
        <div className="flex flex-wrap gap-2">
          {(Array.isArray(node.images) ? (node.images as CardNode[]) : []).map((image, index) => (
            <CardImage key={index} node={image} sizeOverride={str(node.imageSize) ?? 'medium'} />
          ))}
        </div>
      )
    case 'Container':
      return (
        <Container node={node}>
          <Elements nodes={node.items} />
        </Container>
      )
    case 'ColumnSet':
      return <ColumnSet node={node} />
    case 'FactSet':
      return <FactSet node={node} />
    case 'ActionSet':
      return <ActionButtons actions={node.actions} isPrimaryRow={false} />
    case 'Table':
      return <CardTable node={node} />
    default:
      return node.type.startsWith('Input.') ? <CardInputField node={node} /> : null
  }
}

function Element({ node, isFirst }: { node: CardNode; isFirst: boolean }) {
  const { hidden } = useCard()
  const id = str(node.id)
  const visible = id && id in hidden ? !hidden[id] : node.isVisible !== false
  if (!visible) return null
  if (!knownTypes[node.type]) {
    const fallback = node.fallback
    return fallback && typeof fallback === 'object' ? <Element node={fallback as CardNode} isFirst={isFirst} /> : null
  }
  const spacing = isFirst ? 0 : (spacingPixels[lower(node.spacing) || 'default'] ?? 8)
  return (
    <div style={{ marginTop: spacing }} className={node.separator === true && !isFirst ? 'border-t border-line pt-2' : undefined}>
      <Selectable node={node}>
        <ElementContent node={node} />
      </Selectable>
    </div>
  )
}

function CardBody({ card }: { card: AdaptiveCard }) {
  return (
    <div className="flex flex-col">
      <Elements nodes={card.body} />
      {Array.isArray(card.actions) && card.actions.length > 0 && (
        <div className="mt-4">
          <ActionButtons actions={card.actions} isPrimaryRow />
        </div>
      )}
    </div>
  )
}

/** An `adaptive_card` block. */
export function AdaptiveCardView({ block, onSubmit, answerActionIds = [], isSubmitting = false }: AdaptiveCardViewProps) {
  const inputs = useMemo(() => collectInputs(block.card), [block.card])
  const [values, setValues] = useState<CardValues>(() => initialCardValues(inputs))
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const missing = missingRequiredInputs(inputs, values)
  const answerOf = (action: CardNode) => resolveAnswerAction(actionKey(action), answerActionIds)
  const submitHint = !onSubmit
    ? messages().visuals.buttonsWorkWhenAsked
    : missing.length > 0
      ? messages().visuals.fillInBeforeSending(missing.join(', '))
      : null

  const context: CardContextValue = {
    values,
    setValue: (id, value) => setValues((current) => ({ ...current, [id]: value })),
    hidden,
    isSubmitting,
    submitHint,
    toggle: (targets) => {
      const list = Array.isArray(targets) ? targets : []
      setHidden((current) => {
        const next = { ...current }
        for (const target of list) {
          const id = typeof target === 'string' ? target : str((target as CardNode)?.elementId)
          if (!id) continue
          const explicit = typeof target === 'object' && typeof (target as CardNode).isVisible === 'boolean' ? !(target as CardNode).isVisible : undefined
          const currentlyHidden = id in next ? next[id] : findInitiallyHidden(block.card, id)
          next[id] = explicit ?? !currentlyHidden
        }
        return next
      })
    },
    canSubmit: (action) => Boolean(onSubmit) && missing.length === 0 && answerOf(action) !== null,
    runAction: (action) => {
      if (action.type === 'Action.OpenUrl' && typeof action.url === 'string' && isSafeCardLink(action.url)) {
        openCardLink(action.url).catch((openError: unknown) => console.warn('Could not open a card link', openError))
        return
      }
      if (action.type === 'Action.ToggleVisibility') return context.toggle(action.targetElements)
      if (action.type !== 'Action.Submit' && action.type !== 'Action.Execute') return
      const answer = answerOf(action)
      if (!onSubmit || answer === null || missing.length > 0) return
      onSubmit({ action: answer, values: buildSubmissionValues(action, inputs, values) })
    },
  }

  return (
    <CardContext.Provider value={context}>
      <div className="text-[14px] text-ink">
        <CardBody card={block.card} />
      </div>
    </CardContext.Provider>
  )
}

/** Whether the element `id` starts hidden (`isVisible: false`), for Action.ToggleVisibility. */
function findInitiallyHidden(card: AdaptiveCard, id: string): boolean {
  let found = false
  const visit = (nodes: unknown) => {
    if (!Array.isArray(nodes) || found) return
    for (const node of nodes as CardNode[]) {
      if (node?.id === id) {
        found = node.isVisible === false
        return
      }
      visit(node?.items)
      visit(node?.columns)
      visit(node?.rows)
      visit(node?.cells)
    }
  }
  visit(card.body)
  return found
}

export default AdaptiveCardView
