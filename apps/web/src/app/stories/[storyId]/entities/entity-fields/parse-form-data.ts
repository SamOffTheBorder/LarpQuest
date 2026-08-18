import type { Field } from '@/lib/engine/schema';

/**
 * Reconstruct an entity's `data` object from a submitted `EntitySchemaForm`.
 * The inverse of `EntityFieldRenderer`'s per-type rendering: each field's raw
 * form value is parsed back into the shape `buildEntityDataValidator` (and
 * the composite `fieldValueSchema` in schema.ts) expects. Dispatches on
 * `field.type` only, mirroring the same bounded vocabulary used everywhere
 * else in the schema system.
 */
export function parseEntityFormData(
  fields: readonly Field[],
  formData: FormData,
  fieldName: (key: string) => string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = formData.get(fieldName(field.key));

    if (typeof raw !== 'string' || raw.length === 0) {
      continue;
    }

    switch (field.type) {
      case 'string':
      case 'text':
      case 'enum':
      case 'reference':
        data[field.key] = raw;
        break;

      case 'number': {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) {
          data[field.key] = parsed;
        }
        break;
      }

      case 'resource': {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) {
          data[field.key] = { current: parsed, max: field.max };
        }
        break;
      }

      case 'capability_list':
      case 'relationship_map':
      case 'knowledge_set':
      case 'standing_map':
      case 'tag_list':
        try {
          data[field.key] = JSON.parse(raw);
        } catch {
          // Left out of `data` rather than stored as a raw string: these
          // fields are structured, and a JSON parse failure means the user's
          // edit was incomplete — buildEntityDataValidator will reject the
          // resulting shape if the field is required, surfacing the mistake.
        }
        break;

      default: {
        const exhaustive: never = field;
        throw new Error(`Unhandled field type: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return data;
}
