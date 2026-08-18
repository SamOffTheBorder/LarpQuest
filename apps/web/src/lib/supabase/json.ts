import type { Json } from '@/lib/supabase/database.types';

/**
 * Bridge between opaque engine values and the generated `Json` type.
 *
 * Entity `data` is deliberately `unknown` throughout the engine — nothing may
 * inspect it. But the Supabase client types jsonb columns as `Json`, which is
 * structurally narrower than `unknown`. Rather than scattering casts at every
 * call site, the conversion happens here, once, where the reason for it is
 * written down.
 *
 * This does not validate: values reaching the database are already jsonb-shaped
 * by construction (they came from jsonb, or from a Zod-parsed model response).
 */
export function toJson(value: unknown): Json {
  return value as Json;
}
