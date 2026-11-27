import type { UiBlock } from '@/components/visuals/uiBlockTypes'

/**
 * UI blocks the sample chatbot shows in the browser preview, so the Try it panel demonstrates what a chatbot
 * with `ui-render` tools returns: an order card with buttons and a chart, and a diagram.
 */

export const sampleOrderCard: UiBlock = {
  $ui: 'adaptive_card',
  version: 1,
  title: 'Pesanan nasi box',
  card: {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: 'Paket **Ayam Bakar** untuk 50 orang, diantar Sabtu pukul 11.00.', wrap: true },
      {
        type: 'FactSet',
        facts: [
          { title: 'Harga per box', value: 'Rp 35.000' },
          { title: 'Total', value: 'Rp 1.750.000' },
          { title: 'Ongkir', value: 'Gratis (di atas 30 box)' },
        ],
      },
      { type: 'Input.Text', id: 'catatan', label: 'Catatan untuk dapur', placeholder: 'Opsional, misalnya sambal dipisah' },
    ],
    actions: [
      { type: 'Action.Submit', id: 'konfirmasi', title: 'Konfirmasi pesanan', style: 'positive' },
      { type: 'Action.Submit', id: 'ubah', title: 'Ubah jumlah' },
    ],
  },
}

export const sampleMenuChart: UiBlock = {
  $ui: 'chart',
  version: 1,
  type: 'bar',
  title: 'Paket paling sering dipesan',
  subtitle: '30 hari terakhir',
  x: { values: ['Ayam Bakar', 'Rendang', 'Ayam Geprek', 'Nasi Kuning', 'Vegetarian'] },
  y: { label: 'Box' },
  series: [
    { name: 'Hari kerja', values: [420, 310, 280, 150, 60] },
    { name: 'Akhir pekan', values: [260, 240, 120, 210, 45] },
  ],
}

export const sampleOrderDiagram: UiBlock = {
  $ui: 'diagram',
  version: 1,
  title: 'Alur pesanan',
  subtitle: 'Dari chat pertama sampai diantar',
  fallback_text: 'Bot mengecek stok, mencatat pesanan, lalu pemilik mengonfirmasi sebelum diantar.',
  syntax: 'mermaid',
  source: [
    'flowchart TD',
    '  A[Pelanggan bertanya] --> B{Menu tersedia?}',
    '  B -- Ya --> C[Bot mencatat pesanan]',
    '  B -- Tidak --> D[Tawarkan paket lain]',
    '  D --> B',
    '  C --> E[Pemilik konfirmasi]',
    '  E --> F[Pembayaran]',
    '  F --> G([Diantar])',
  ].join('\n'),
}
