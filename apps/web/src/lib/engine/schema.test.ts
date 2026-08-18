import { describe, expect, it } from 'vitest';

import {
  buildEntityDataValidator,
  entitySchemaSchema,
  fieldSchema,
  UnknownEntityTypeError,
  type EntitySchema,
} from '@/lib/engine/schema';

const ALL_PRIMITIVES: EntitySchema = {
  entity_types: {
    kitchen_sink: {
      label: 'Kitchen Sink',
      fields: [
        { key: 'aString', type: 'string' },
        { key: 'aText', type: 'text' },
        { key: 'anEnum', type: 'enum', values: ['a', 'b'] },
        { key: 'aNumber', type: 'number' },
        { key: 'aResource', type: 'resource', max: 100 },
        { key: 'aCapabilityList', type: 'capability_list' },
        { key: 'aRelationshipMap', type: 'relationship_map' },
        { key: 'aKnowledgeSet', type: 'knowledge_set' },
        { key: 'aStandingMap', type: 'standing_map' },
        { key: 'aTagList', type: 'tag_list' },
        { key: 'aReference', type: 'reference' },
      ],
    },
  },
};

describe('entitySchemaSchema', () => {
  it('accepts a schema using every registered primitive', () => {
    expect(() => entitySchemaSchema.parse(ALL_PRIMITIVES)).not.toThrow();
  });

  it('rejects a field with an unregistered type', () => {
    const bad = {
      entity_types: {
        character: {
          label: 'Character',
          fields: [{ key: 'powerLevel', type: 'power_tier' }],
        },
      },
    };

    expect(() => entitySchemaSchema.parse(bad)).toThrow();
  });

  it('field schema is a closed discriminated union, not an open string', () => {
    expect(fieldSchema.safeParse({ key: 'x', type: 'nonexistent_primitive' }).success).toBe(
      false,
    );
  });
});

describe('buildEntityDataValidator', () => {
  it('accepts data matching every primitive type', () => {
    const validator = buildEntityDataValidator(ALL_PRIMITIVES, 'kitchen_sink');

    const result = validator.safeParse({
      aString: 'hello',
      aText: 'longer text',
      anEnum: 'a',
      aNumber: 42,
      aResource: { current: 10, max: 100 },
      aCapabilityList: [{ id: '1', name: 'Flight', status: 'available' }],
      aRelationshipMap: { Alice: 'friendly', Bob: 3 },
      aKnowledgeSet: ['knows the secret'],
      aStandingMap: { Vigil: 5, Cinderline: -3 },
      aTagList: ['injured', 'cursed'],
      aReference: 'entity-id-123',
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['aString', 42],
    ['anEnum', 'not-a-valid-value'],
    ['aNumber', 'not-a-number'],
    ['aResource', { current: 'ten', max: 100 }],
    ['aCapabilityList', { not: 'an array' }],
    ['aKnowledgeSet', 'not an array'],
  ])('rejects a wrong-typed value for %s', (key, value) => {
    const validator = buildEntityDataValidator(ALL_PRIMITIVES, 'kitchen_sink');

    const result = validator.safeParse({ [key]: value });

    expect(result.success).toBe(false);
  });

  it('leaves fields absent from the schema untouched, like Phase 1 opaque data', () => {
    const validator = buildEntityDataValidator(ALL_PRIMITIVES, 'kitchen_sink');

    const result = validator.safeParse({
      aString: 'hello',
      somethingTheSchemaNeverMentioned: { arbitrary: 'shape' },
    });

    expect(result.success).toBe(true);
  });

  it('throws a typed error for an entity type the schema does not define', () => {
    expect(() => buildEntityDataValidator(ALL_PRIMITIVES, 'faction')).toThrow(
      UnknownEntityTypeError,
    );
  });

  it('validates two structurally different schemas through the same function', () => {
    const powerSchema: EntitySchema = {
      entity_types: {
        character: {
          label: 'Character',
          fields: [
            { key: 'powerLevel', type: 'number' },
            { key: 'abilities', type: 'capability_list' },
          ],
        },
      },
    };

    const socialSchema: EntitySchema = {
      entity_types: {
        character: {
          label: 'Character',
          fields: [
            { key: 'knowledge', type: 'knowledge_set' },
            { key: 'relationships', type: 'relationship_map' },
          ],
        },
      },
    };

    const powerValidator = buildEntityDataValidator(powerSchema, 'character');
    const socialValidator = buildEntityDataValidator(socialSchema, 'character');

    expect(
      powerValidator.safeParse({ powerLevel: 7, abilities: [] }).success,
    ).toBe(true);
    expect(
      socialValidator.safeParse({ knowledge: ['a fact'], relationships: {} }).success,
    ).toBe(true);
  });
});
