import { z } from 'zod';

/**
 * Entity Schema — the engine's field-type vocabulary (build plan Part 3.2).
 *
 * These eleven primitives are the entire vocabulary. A universe composes
 * them to describe its own entity types; the engine never adds a
 * domain-specific type, and nothing here branches on genre, universe, or
 * media type — only on which of these eleven kinds a field is. That bounded
 * dispatch is what lets `buildEntityDataValidator` below validate a
 * power-scaling superhero universe and a cozy social-mystery universe with
 * the exact same code path (see entity-schema spec, "Validator dispatches on
 * field type, not on universe").
 */

const baseFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
});

const stringField = baseFieldSchema.extend({ type: z.literal('string') }).strict();
const textField = baseFieldSchema.extend({ type: z.literal('text') }).strict();

const enumField = baseFieldSchema
  .extend({
    type: z.literal('enum'),
    values: z.array(z.string().min(1)).min(1),
  })
  .strict();

const numberField = baseFieldSchema
  .extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict();

const resourceField = baseFieldSchema
  .extend({
    type: z.literal('resource'),
    max: z.number(),
  })
  .strict();

/** The Part 3.3 capability status lifecycle, enforced by `ability_unlock`. */
export const CAPABILITY_STATUSES = [
  'proposed',
  'developing',
  'available',
  'mastered',
  'lost',
  'sealed',
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

const capabilityListField = baseFieldSchema
  .extend({ type: z.literal('capability_list') })
  .strict();

const relationshipMapField = baseFieldSchema
  .extend({ type: z.literal('relationship_map') })
  .strict();

const knowledgeSetField = baseFieldSchema
  .extend({ type: z.literal('knowledge_set') })
  .strict();

const standingMapField = baseFieldSchema
  .extend({ type: z.literal('standing_map') })
  .strict();

const tagListField = baseFieldSchema.extend({ type: z.literal('tag_list') }).strict();

const referenceField = baseFieldSchema
  .extend({
    type: z.literal('reference'),
    entityType: z.string().min(1).optional(),
  })
  .strict();

export const fieldSchema = z.discriminatedUnion('type', [
  stringField,
  textField,
  enumField,
  numberField,
  resourceField,
  capabilityListField,
  relationshipMapField,
  knowledgeSetField,
  standingMapField,
  tagListField,
  referenceField,
]);

export type Field = z.infer<typeof fieldSchema>;
export type FieldType = Field['type'];

const entityTypeSchema = z.object({
  label: z.string().min(1),
  fields: z.array(fieldSchema),
});

export const entitySchemaSchema = z.object({
  entity_types: z.record(z.string().min(1), entityTypeSchema),
});

export type EntitySchema = z.infer<typeof entitySchemaSchema>;

export class UnknownEntityTypeError extends Error {
  constructor(readonly entityType: string) {
    super(`Entity type "${entityType}" is not defined in this universe's schema.`);
    this.name = 'UnknownEntityTypeError';
  }
}

const capabilityItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  status: z.enum(CAPABILITY_STATUSES),
});

/** A single field-primitive's value validator. Dispatches on `field.type` only. */
function fieldValueSchema(field: Field): z.ZodType {
  switch (field.type) {
    case 'string':
      return z.string();
    case 'text':
      return z.string();
    case 'enum':
      return z.enum(field.values as [string, ...string[]]);
    case 'number':
      return z.number().min(field.min ?? -Infinity).max(field.max ?? Infinity);
    case 'resource':
      return z.object({
        current: z.number().min(0).max(field.max),
        max: z.number().max(field.max),
      });
    case 'capability_list':
      return z.array(capabilityItemSchema.passthrough());
    case 'relationship_map':
      return z.record(z.string(), z.union([z.string(), z.number()]));
    case 'knowledge_set':
      return z.array(z.string());
    case 'standing_map':
      return z.record(z.string(), z.number());
    case 'tag_list':
      return z.array(z.string());
    case 'reference':
      return z.string().nullable();
    default: {
      const exhaustive: never = field;
      throw new Error(`Unhandled field type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Compile a schema's field list for one entity type into a Zod object
 * validator. Fields absent from the schema are left untouched (matches
 * Phase 1's opaque-extra-fields behavior for stories with no pinned
 * universe) — this only constrains fields the schema actually declares.
 */
export function buildEntityDataValidator(
  entitySchema: EntitySchema,
  entityType: string,
): z.ZodType<Record<string, unknown>> {
  const definition = entitySchema.entity_types[entityType];

  if (definition === undefined) {
    throw new UnknownEntityTypeError(entityType);
  }

  const shape: Record<string, z.ZodType> = {};

  for (const field of definition.fields) {
    const valueSchema = fieldValueSchema(field);
    shape[field.key] = field.required === true ? valueSchema : valueSchema.optional();
  }

  return z.object(shape).passthrough();
}
