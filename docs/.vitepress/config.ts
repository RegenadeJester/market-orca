import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Anomali Docs',
  description: 'Market Orca — Real-time Market Intelligence & AI Report Engine',
  lang: 'en-US',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#3451b2' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Anomali Docs',

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'API', link: '/api/backend', activeMatch: '/api/' },
      { text: 'Integrations', link: '/integration/n8n', activeMatch: '/integration/' },
      {
        text: 'Links',
        items: [
          { text: 'GitHub', link: 'https://github.com/anomali/market-orca' },
          { text: 'Status', link: 'https://status.anomali.web.id' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Backend API', link: '/api/backend' },
            { text: 'Report Dashboard', link: '/api/report' },
            { text: 'MCP Tools', link: '/api/mcp' },
          ],
        },
      ],
      '/integration/': [
        {
          text: 'Integrations',
          items: [
            { text: 'n8n Workflows', link: '/integration/n8n' },
            { text: 'Obsidian', link: '/integration/obsidian' },
            { text: 'Notion', link: '/integration/notion' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/anomali/market-orca' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/anomali/market-orca/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2025 Anomali — Market Orca',
    },

    outline: {
      level: [2, 3],
      label: 'On this page',
    },

    lastUpdated: {
      text: 'Last updated',
    },

    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },

    returnToTopLabel: 'Return to top',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Theme',
  },

  markdown: {
    lineNumbers: true,
    math: false,
  },

  vite: {
    server: {
      port: 4173,
      host: '0.0.0.0',
    },
  },
})
