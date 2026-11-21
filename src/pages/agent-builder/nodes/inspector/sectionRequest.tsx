import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { InspectorSectionRequest } from '../contracts'

/**
 * Opening a part of the inspector on request (`NodeInspectorProps.requestedSection`):
 * the canvas menu's "Change action", the problems list's "Show node" or a field error.
 * A request targets
 * - a section by key: `change-action` (opens the action picker), `on-error` ("When this
 *   step fails"), or another `InspectorSection` `sectionKey` (`sign-in`, `inputs`…);
 * - a field by its config path (`url`, `authorization.config.api_key`, `config.query`):
 *   the section holding it opens, it scrolls into view and its control gets focus.
 *
 * Each request is handled once (its `sequence`), by the first part that finds it
 * ({@link SectionRequestValue.claim}); sections look inside themselves even while closed.
 */

/** Data attribute fields carry so a request can find them (`data-field-path="url"`). */
export const fieldPathAttribute = 'data-field-path'
/** Marks section bodies; the inspector-level fallback only searches outside them. */
export const sectionContentAttribute = 'data-inspector-section-content'

export interface SectionRequestValue {
  /** The request for the node shown, or null. */
  request: InspectorSectionRequest | null
  /** True for the first caller of a sequence: it handles the request, everyone else ignores it. */
  claim: (sequence: number) => boolean
}

const SectionRequestContext = createContext<SectionRequestValue>({ request: null, claim: () => false })

/** Provides the current request to the inspector parts of one node. */
export function SectionRequestProvider({ request, children }: { request: InspectorSectionRequest | null; children: ReactNode }) {
  const claimedSequenceRef = useRef<number | null>(null)
  const claim = useCallback((sequence: number) => {
    if (claimedSequenceRef.current === sequence) return false
    claimedSequenceRef.current = sequence
    return true
  }, [])
  const value = useMemo(() => ({ request, claim }), [request, claim])
  return <SectionRequestContext.Provider value={value}>{children}</SectionRequestContext.Provider>
}

export function useSectionRequest(): SectionRequestValue {
  return useContext(SectionRequestContext)
}

/** True for section keys such as `change-action` or `on-error` (kebab-case, never a config path). */
export function isSectionKeyTarget(target: string): boolean {
  return /^[a-z]+(-[a-z]+)+$/.test(target)
}

/** `config.authorization.config.api_key` → `authorization.config.api_key`. */
export function normalizeFieldPath(target: string): string {
  return target.trim().replace(/^config[./]/, '').replaceAll('/', '.')
}

const focusableSelector = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"], button'

/** The first enabled control inside `container`. */
export function firstFocusable(container: Element | null): HTMLElement | null {
  if (!container) return null
  if (container.matches(focusableSelector)) return container as HTMLElement
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].find((element) => !element.hasAttribute('disabled')) ?? null
}

function plainWords(text: string): string {
  return text
    .replace(/[*_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isOutsideSections(element: Element, root: Element, skipSections: boolean): boolean {
  if (!skipSections) return true
  const section = element.closest(`[${sectionContentAttribute}]`)
  return section === null || section === root || !root.contains(section)
}

/**
 * The control of the field `target` names inside `root`: a `data-field-path` match first
 * (exact, then the closest enclosing field), else a label or accessible name matching the
 * last path segment ("api_key" → "API key").
 *
 * @param root - Where to look (Element)
 * @param target - A config path (string)
 * @param skipSections - Ignore fields inside section bodies (the inspector-level fallback)
 * @returns The control to focus, or null when the field is not there (HTMLElement | null)
 */
export function findFieldControl(root: Element | null, target: string, skipSections = false): HTMLElement | null {
  if (!root) return null
  const path = normalizeFieldPath(target)
  const tagged = [...root.querySelectorAll<HTMLElement>(`[${fieldPathAttribute}]`)].filter((element) => isOutsideSections(element, root, skipSections))
  const exact = tagged.find((element) => element.getAttribute(fieldPathAttribute) === path)
  const enclosing = tagged
    .filter((element) => path.startsWith(`${element.getAttribute(fieldPathAttribute)}.`))
    .sort((left, right) => (right.getAttribute(fieldPathAttribute)?.length ?? 0) - (left.getAttribute(fieldPathAttribute)?.length ?? 0))[0]
  const byPath = exact ?? enclosing
  if (byPath) return firstFocusable(byPath)
  const words = plainWords(path.split('.').at(-1) ?? '')
  if (!words) return null
  const label = [...root.querySelectorAll('label')].find((element) => isOutsideSections(element, root, skipSections) && plainWords(element.textContent ?? '') === words)
  if (label) {
    const labelled = label.htmlFor ? root.querySelector(`#${CSS.escape(label.htmlFor)}`) : null
    return firstFocusable(labelled ?? label.parentElement)
  }
  return [...root.querySelectorAll<HTMLElement>('[aria-label]')].find((element) => isOutsideSections(element, root, skipSections) && element.matches(focusableSelector) && plainWords(element.getAttribute('aria-label') ?? '') === words) ?? null
}

/** Scrolls `element` into the middle of the inspector and focuses it. */
export function revealElement(element: HTMLElement | null): void {
  if (!element) return
  const prefersReducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  element.focus({ preventScroll: true })
}

/**
 * Handles requests for fields outside any section (header, action picker area): runs
 * after the sections had their turn in the same commit.
 */
export function useFieldRequestFallback(rootRef: RefObject<HTMLElement | null>) {
  const { request, claim } = useSectionRequest()
  useEffect(() => {
    if (!request) return
    const control = findFieldControl(rootRef.current, request.section, true)
    if (control && claim(request.sequence)) revealElement(control)
  }, [request, claim, rootRef])
}
