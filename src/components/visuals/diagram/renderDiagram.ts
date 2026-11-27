/**
 * Draws Mermaid text as a standalone SVG. Mermaid (and its per-diagram chunks) is imported here and only here,
 * on the first call, so screens without a diagram never download it.
 *
 * Locked down, on top of graphrt-ui's validation of the source (no HTML, links, callbacks, directives):
 * - `securityLevel: 'strict'`: no click handlers, text is escaped;
 * - `htmlLabels: false`: labels are SVG text, so the result has no `<foreignObject>` HTML;
 * - the result is refused if it still carries a script, a `foreignObject` or an event handler attribute.
 * The caller shows the SVG as an `<img>` data URL: an image runs no scripts, loads nothing and has no links.
 */

export interface DiagramTheme {
  isDark: boolean
  /** CSS colours read from the app's tokens. */
  surface: string
  ink: string
  muted: string
  line: string
  nodeFill: string
  groupFill: string
  noteFill: string
  noteLine: string
  /** Categorical colours for pies, git branches and timelines. */
  series: string[]
}

export interface RenderedDiagram {
  svg: string
  width: number
  height: number
}

/** Text is measured in the document and drawn inside an image, so both must use fonts every system has. */
export const DIAGRAM_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

let renderQueue: Promise<unknown> = Promise.resolve()
let renderCount = 0

function themeVariables(theme: DiagramTheme): Record<string, string | boolean> {
  const scale = Object.fromEntries(theme.series.flatMap((colour, index) => [[`pie${index + 1}`, colour], [`git${index}`, colour], [`cScale${index}`, colour]]))
  return {
    darkMode: theme.isDark,
    fontFamily: DIAGRAM_FONT_FAMILY,
    fontSize: '14px',
    background: theme.surface,
    primaryColor: theme.nodeFill,
    primaryTextColor: theme.ink,
    primaryBorderColor: theme.line,
    secondaryColor: theme.groupFill,
    secondaryTextColor: theme.ink,
    secondaryBorderColor: theme.line,
    tertiaryColor: theme.groupFill,
    tertiaryTextColor: theme.ink,
    tertiaryBorderColor: theme.line,
    lineColor: theme.muted,
    textColor: theme.ink,
    mainBkg: theme.nodeFill,
    nodeBorder: theme.line,
    clusterBkg: theme.groupFill,
    clusterBorder: theme.line,
    titleColor: theme.ink,
    edgeLabelBackground: theme.surface,
    noteBkgColor: theme.noteFill,
    noteTextColor: theme.ink,
    noteBorderColor: theme.noteLine,
    actorBkg: theme.nodeFill,
    actorBorder: theme.line,
    actorTextColor: theme.ink,
    actorLineColor: theme.muted,
    signalColor: theme.muted,
    signalTextColor: theme.ink,
    labelBoxBkgColor: theme.nodeFill,
    labelBoxBorderColor: theme.line,
    labelTextColor: theme.ink,
    loopTextColor: theme.ink,
    activationBkgColor: theme.groupFill,
    activationBorderColor: theme.line,
    pieTitleTextColor: theme.ink,
    pieSectionTextColor: '#FFFFFF',
    pieLegendTextColor: theme.ink,
    pieStrokeColor: theme.surface,
    pieOuterStrokeColor: theme.line,
    pieOpacity: '1',
    gitBranchLabel0: '#FFFFFF',
    commitLabelColor: theme.ink,
    commitLabelBackground: theme.groupFill,
    quadrant1Fill: theme.nodeFill,
    quadrant2Fill: theme.groupFill,
    quadrant3Fill: theme.nodeFill,
    quadrant4Fill: theme.groupFill,
    quadrant1TextFill: theme.ink,
    quadrant2TextFill: theme.ink,
    quadrant3TextFill: theme.ink,
    quadrant4TextFill: theme.ink,
    quadrantPointFill: theme.series[0] ?? theme.ink,
    quadrantPointTextFill: theme.ink,
    quadrantXAxisTextFill: theme.ink,
    quadrantYAxisTextFill: theme.ink,
    quadrantTitleFill: theme.ink,
    quadrantInternalBorderStrokeFill: theme.line,
    quadrantExternalBorderStrokeFill: theme.line,
    ...scale,
  }
}

/** What an SVG shown to people must not contain, whatever produced it. */
const unsafeSvg = /<script[\s>]|<foreignObject[\s>]|<iframe[\s>]|\son[a-z]+\s*=|javascript:/i

/**
 * The SVG's size from its `viewBox`, written into `width` / `height` so an `<img>` knows its natural size.
 *
 * @param svg - Mermaid's SVG text (string)
 * @returns The sized SVG, or null when it has no usable viewBox (RenderedDiagram | null)
 */
export function sizeSvg(svg: string): RenderedDiagram | null {
  const viewBox = /viewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg)
  if (!viewBox) return null
  const width = Math.ceil(Number(viewBox[3]))
  const height = Math.ceil(Number(viewBox[4]))
  if (!(width > 0) || !(height > 0)) return null
  const open = /^<svg\b[^>]*>/.exec(svg)
  if (!open) return null
  const tag = open[0].replace(/\s(width|height)="[^"]*"/g, '').replace(/\sstyle="[^"]*"/, '').replace(/^<svg\b/, `<svg width="${width}" height="${height}"`)
  return { svg: tag + svg.slice(open[0].length), width, height }
}

/** Whether `svg` is free of scripts, HTML islands and event handlers. */
export function isInertSvg(svg: string): boolean {
  return !unsafeSvg.test(svg)
}

/**
 * Renders validated Mermaid `source` in `theme`. Renders run one at a time: Mermaid keeps one global config.
 *
 * @throws Error - When Mermaid cannot parse the source, or the SVG is not inert
 */
export function renderDiagram(source: string, theme: DiagramTheme): Promise<RenderedDiagram> {
  const run = async (): Promise<RenderedDiagram> => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      maxTextSize: 20000,
      maxEdges: 500,
      theme: 'base',
      fontFamily: DIAGRAM_FONT_FAMILY,
      themeVariables: themeVariables(theme),
      flowchart: { htmlLabels: false, useMaxWidth: false },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      er: { useMaxWidth: false },
      state: { useMaxWidth: false },
      class: { useMaxWidth: false },
      pie: { useMaxWidth: false },
    })
    renderCount += 1
    const { svg } = await mermaid.render(`graphrt-diagram-${renderCount}`, source)
    const sized = isInertSvg(svg) ? sizeSvg(svg) : null
    if (!sized) throw new Error('the diagram did not produce a plain picture')
    return sized
  }
  const result = renderQueue.then(run, run)
  renderQueue = result.catch(() => undefined)
  return result
}
