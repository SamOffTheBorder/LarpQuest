/**
 * Two hand-built test universes for Phase Exit Verification (tasks 10.1–10.2).
 *
 * Deliberately structurally incompatible with each other, on purpose: if the
 * engine has any hidden assumption about entity shape — an `abilities` field
 * it treats specially, code that expects a `powerLevel` number, anything that
 * would make one of these "the normal case" — running both through the same
 * unmodified turn loop is what would expose it. Per CLAUDE.md's core
 * constraint, engine code must never branch on genre, universe, or media type;
 * these fixtures exist to prove that in practice, not just by inspection.
 *
 * Not consumed by the engine itself — nothing here is imported outside tests
 * and seed scripts. `EntityData` stays opaque; this module just proposes some
 * story-specific content for it, same as a real user typing into the UI would.
 */

import type { EntityData } from '@/lib/engine/context';
import type { EntitySchema } from '@/lib/engine/schema';

export interface TestUniverseEntity {
  type: string;
  name: string;
  data: EntityData;
}

export interface TestUniverse {
  slug: string;
  title: string;
  contentRating: 'everyone' | 'teen' | 'mature';
  toneDirectives: string;
  worldLedger: Record<string, unknown>;
  entities: TestUniverseEntity[];
  /**
   * Phase 2: the schema and progression model this universe would publish as
   * its version 1. Structurally incompatible with the other fixture's schema
   * on purpose — same reason the entity data below is incompatible (see file
   * doc comment). `buildEntityDataValidator` and `resolveProgressionModel`
   * must handle both through the same code path with no branch on which
   * universe they came from.
   */
  entitySchema: EntitySchema;
  progressionModel: string;
}

/**
 * Ashfall Legion — a power-scaling superhero universe. Entities carry an
 * `abilities` array of structured objects and a numeric `powerLevel`. This is
 * the shape most likely to tempt special-casing ("surely `abilities` needs
 * validation, surely `powerLevel` needs to be numeric") — the test is that the
 * engine handles it with the exact same code path as Wovenmere below.
 */
export const ASHFALL_LEGION: TestUniverse = {
  slug: 'ashfall-legion',
  title: 'Ashfall Legion',
  contentRating: 'teen',
  toneDirectives:
    'Pulpy superhero action with real consequences. Powers are dramatic but not solutions to every problem — cleverness and cost matter as much as strength.',
  worldLedger: {
    setting: 'Meridian City, twelve years after the Ashfall Event seeded latent powers across the population.',
    factions: ['The Vigil (state-sanctioned heroes)', 'Cinderline (underground power-black-market)'],
    activeThreats: ['A weapons cache stolen from a Vigil precinct three nights ago'],
  },
  entities: [
    {
      type: 'character',
      name: 'Reya Okonkwo',
      data: {
        role: 'protagonist',
        affiliation: 'The Vigil',
        powerLevel: 7,
        abilities: [
          {
            id: 'reya-kinetic-echo',
            name: 'Kinetic Echo',
            description: 'Replays the last 10 seconds of impact force on a surface.',
            status: 'available',
          },
          {
            id: 'reya-reflex-surge',
            name: 'Reflex Surge',
            description: 'Brief but total reaction-time enhancement.',
            status: 'available',
          },
        ],
        status: 'active',
        location: 'Vigil Precinct 4',
      },
    },
    {
      type: 'character',
      name: 'Marcus Vell',
      data: {
        role: 'rival',
        affiliation: 'Cinderline',
        powerLevel: 6,
        abilities: [
          {
            id: 'marcus-doubt-weave',
            name: 'Doubt Weave',
            description: 'Projects a targeted illusion of hesitation into a foe\'s mind.',
            status: 'available',
          },
        ],
        status: 'active',
        location: 'unknown',
      },
    },
    {
      type: 'character',
      name: 'Director Priya Chandra',
      data: {
        role: 'authority figure',
        affiliation: 'The Vigil',
        powerLevel: 0,
        abilities: [],
        status: 'active',
        location: 'Vigil HQ',
      },
    },
    {
      type: 'location',
      name: 'Vigil Precinct 4',
      data: {
        description: 'A converted subway depot serving as a forward base.',
        securityLevel: 'high',
        status: 'active',
      },
    },
    {
      type: 'item',
      name: 'The stolen cache',
      data: {
        description: 'Six suppressed power-dampening rounds, missing since the break-in.',
        currentHolder: null,
        status: 'active',
      },
    },
  ],
  entitySchema: {
    entity_types: {
      character: {
        label: 'Character',
        fields: [
          { key: 'role', type: 'string' },
          { key: 'affiliation', type: 'string' },
          { key: 'powerLevel', type: 'number', min: 0, max: 10 },
          { key: 'abilities', type: 'capability_list' },
          {
            key: 'status',
            type: 'enum',
            values: ['active', 'injured', 'critical', 'incapacitated', 'dead'],
          },
          { key: 'location', type: 'reference', entityType: 'location' },
        ],
      },
      location: {
        label: 'Location',
        fields: [
          { key: 'description', type: 'text' },
          { key: 'securityLevel', type: 'enum', values: ['low', 'medium', 'high'] },
          { key: 'status', type: 'enum', values: ['active', 'inactive'] },
        ],
      },
      item: {
        label: 'Item',
        fields: [
          { key: 'description', type: 'text' },
          { key: 'currentHolder', type: 'reference', entityType: 'character' },
          { key: 'status', type: 'enum', values: ['active', 'inactive'] },
        ],
      },
    },
  },
  progressionModel: 'ability_unlock',
};

/**
 * Wovenmere — a cozy village social-mystery universe. No abilities, no power
 * scaling, nothing that resembles combat stats. Entities carry only
 * `knowledge` (a string array of facts they know) and `relationships` (a map
 * of name to disposition). This is the shape that would break first if the
 * engine ever assumed entities look like Ashfall Legion's.
 */
export const WOVENMERE: TestUniverse = {
  slug: 'wovenmere',
  title: 'Wovenmere',
  contentRating: 'everyone',
  toneDirectives:
    'Warm, observational, gently funny. Conflict is social and quiet — a withheld letter, an old grudge, a secret everyone half-suspects. No violence.',
  worldLedger: {
    setting: 'Wovenmere, a wool-trading village on a tidal estuary, the week before the annual Loom Fair.',
    ongoingEvent: 'Someone has been leaving unsigned notes on the baker\'s door.',
  },
  entities: [
    {
      type: 'character',
      name: 'Osric Bramwell',
      data: {
        role: 'protagonist',
        occupation: 'baker',
        knowledge: ['The notes started the same week his sister returned to the village.'],
        relationships: { 'Ivy Bramwell': 'wary', 'Constable Fenn': 'friendly' },
        status: 'active',
      },
    },
    {
      type: 'character',
      name: 'Ivy Bramwell',
      data: {
        role: 'estranged sister',
        occupation: 'wool trader',
        knowledge: ['She wrote the first note, but not the ones after it.'],
        relationships: { 'Osric Bramwell': 'guilty', 'Constable Fenn': 'neutral' },
        status: 'active',
      },
    },
    {
      type: 'character',
      name: 'Constable Fenn',
      data: {
        role: 'town constable',
        occupation: 'constable',
        knowledge: ['Has been quietly asked to look into the notes but suspects it is not a police matter.'],
        relationships: { 'Osric Bramwell': 'friendly', 'Ivy Bramwell': 'neutral' },
        status: 'active',
      },
    },
    {
      type: 'location',
      name: 'The Bramwell Bakery',
      data: {
        description: 'Half-timbered, on the market square, where the notes keep appearing.',
        status: 'active',
      },
    },
    {
      type: 'item',
      name: 'The unsigned notes',
      data: {
        description: 'Four so far, each folded into a small triangle, same handwriting throughout.',
        count: 4,
        status: 'active',
      },
    },
  ],
  entitySchema: {
    entity_types: {
      character: {
        label: 'Character',
        fields: [
          { key: 'role', type: 'string' },
          { key: 'occupation', type: 'string' },
          { key: 'knowledge', type: 'knowledge_set' },
          { key: 'relationships', type: 'relationship_map' },
          { key: 'status', type: 'enum', values: ['active', 'inactive'] },
        ],
      },
      location: {
        label: 'Location',
        fields: [
          { key: 'description', type: 'text' },
          { key: 'status', type: 'enum', values: ['active', 'inactive'] },
        ],
      },
      item: {
        label: 'Item',
        fields: [
          { key: 'description', type: 'text' },
          { key: 'count', type: 'number', min: 0 },
          { key: 'status', type: 'enum', values: ['active', 'inactive'] },
        ],
      },
    },
  },
  progressionModel: 'none',
};

export const TEST_UNIVERSES: readonly TestUniverse[] = [ASHFALL_LEGION, WOVENMERE];
