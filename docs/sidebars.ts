import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: [
        'architecture/core-thesis',
        'architecture/layers',
        'architecture/turn-loop',
        'architecture/schema-system',
        'architecture/universe-versioning',
        'architecture/research-pipeline',
        'architecture/universe-review',
        'architecture/context-assembly',
        'architecture/memory-and-context',
        'architecture/validation-gatekeeping',
        'architecture/multiplayer',
        'architecture/turn-modes',
        'architecture/media-generation',
        'architecture/search-export-sharing',
        'architecture/scheduling',
        'architecture/spend-caps',
        'architecture/account-deletion',
      ],
    },
    {
      type: 'category',
      label: 'Build Phases',
      collapsed: false,
      items: [
        'phases/build-order',
        'phases/phase-1-generic-core',
        'phases/phase-2-universe-system',
        'phases/phase-3-research-pipeline',
        'phases/phase-4-memory',
        'phases/phase-5-multiplayer',
        'phases/phase-6-validation-gatekeeping',
        'phases/phase-7-turn-modes',
        'phases/phase-8-polish',
        'phases/getting-started',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'reference/model-roles',
        'reference/data-model',
        'reference/prompt-templates',
        'reference/spec-workflow',
      ],
    },
  ],
};

export default sidebars;
