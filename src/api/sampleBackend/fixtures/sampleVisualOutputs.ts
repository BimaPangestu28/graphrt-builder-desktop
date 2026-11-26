import type { UiBlock } from '@/components/visuals/uiBlockTypes'

/**
 * UI blocks of the seeded "Maps leads to WhatsApp" 09:00 run, so the browser preview shows the Run result
 * screen with KPI tiles, a chart and an Adaptive Card (what a run with `ui-render` steps returns).
 */
export const sampleMapsLeadsVisuals: Record<string, UiBlock> = {
  kpis: {
    $ui: 'stats',
    version: 1,
    title: 'This morning',
    items: [
      { label: 'Places found', value: 15, delta: 3, caption: 'vs yesterday' },
      { label: 'Messages sent', value: 11, delta: 2 },
      { label: 'Reply rate', value: 36.4, format: 'percent', delta: 4.1, delta_format: 'percent' },
      { label: 'Opted out', value: 1, delta: 1, good: 'down' },
    ],
  },
  replies_by_area: {
    $ui: 'chart',
    version: 1,
    type: 'bar',
    title: 'Messages and replies by area',
    subtitle: 'Last 7 days',
    x: { values: ['Kemang', 'Senopati', 'Menteng', 'Kuningan', 'PIK', 'BSD'] },
    series: [
      { name: 'Messages sent', values: [18, 14, 11, 9, 7, 5] },
      { name: 'Replies', values: [7, 6, 3, 4, 1, 2] },
    ],
  },
  best_lead: {
    $ui: 'adaptive_card',
    version: 1,
    title: 'Best lead today',
    card: {
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'stretch',
              items: [
                { type: 'TextBlock', text: 'Kopi Kenangan Senopati', size: 'Large', weight: 'Bolder', wrap: true },
                { type: 'TextBlock', text: 'Replied in 4 minutes: **"Can you send the catering menu for 40 people?"**', wrap: true },
              ],
            },
            { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: 'Hot lead', color: 'Good', weight: 'Bolder' }] },
          ],
        },
        {
          type: 'FactSet',
          spacing: 'Medium',
          facts: [
            { title: 'Phone', value: '+62 812 0000 1234' },
            { title: 'Rating', value: '4.7 (1,284 reviews)' },
            { title: 'Next step', value: 'Send the menu and a tasting offer' },
          ],
        },
      ],
      actions: [
        { type: 'Action.Submit', id: 'send_menu', title: 'Send the menu' },
        { type: 'Action.OpenUrl', title: 'Open in Maps', url: 'https://maps.google.com/?q=Kopi+Kenangan+Senopati' },
      ],
    },
  },
}
