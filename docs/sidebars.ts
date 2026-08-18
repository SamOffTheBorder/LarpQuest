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
        'architecture/validation-gatekeeping',
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
