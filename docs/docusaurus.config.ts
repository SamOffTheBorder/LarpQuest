import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'StoryForge',
  tagline: 'A universe-agnostic, multiplayer, AI-driven collaborative fiction engine',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://storyforge.example.com',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'StoryForge',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Architecture',
          items: [
            {label: 'Core Thesis', to: '/architecture/core-thesis'},
            {label: 'The Turn Loop', to: '/architecture/turn-loop'},
            {label: 'Schema System', to: '/architecture/schema-system'},
          ],
        },
        {
          title: 'Build',
          items: [
            {label: 'Build Order', to: '/phases/build-order'},
            {label: 'Phase 1 — Generic Core', to: '/phases/phase-1-generic-core'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {label: 'Model Roles', to: '/reference/model-roles'},
            {label: 'Data Model', to: '/reference/data-model'},
            {label: 'Prompt Templates', to: '/reference/prompt-templates'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} StoryForge.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['sql', 'bash'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
