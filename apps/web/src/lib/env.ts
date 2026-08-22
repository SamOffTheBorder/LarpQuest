import { z } from 'zod';

/**
 * Environment validation.
 *
 * Split into two schemas because the client bundle only ever sees
 * NEXT_PUBLIC_* vars. Importing `serverEnv` from a client component is a
 * build-time error by way of `server-only` in the modules that use it.
 *
 * The app refuses to start when anything here is missing. That is deliberate:
 * the failure mode we are avoiding is provider keys being written unencrypted
 * because ENCRYPTION_MASTER_KEY silently defaulted to undefined.
 */

/** AES-256-GCM requires exactly 32 bytes of key material. */
const MASTER_KEY_BYTES = 32;

const base64Key = z
  .string()
  .min(1, 'must not be empty')
  .refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === MASTER_KEY_BYTES;
      } catch {
        return false;
      }
    },
    `must be ${MASTER_KEY_BYTES} bytes, base64-encoded — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
  );

const clientSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  ENCRYPTION_MASTER_KEY: base64Key,
  /** Bearer token required to trigger the scheduled worker routes. */
  WORKER_SECRET: z.string().min(16, 'must be at least 16 characters'),
  /**
   * Vercel Cron's own bearer token. Optional: only deployments scheduled by
   * Vercel Cron set it, since Vercel injects this fixed name and offers no way
   * to rename it to WORKER_SECRET. Deployments driven by any other scheduler
   * leave it unset and authenticate with WORKER_SECRET alone.
   */
  CRON_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
  /**
   * Inngest deploy keys. Optional: absent in local dev, where the Inngest SDK
   * auto-discovers the local Dev Server (`npm run dev:inngest`) without them.
   * Required in production — Inngest Cloud rejects unsigned requests there.
   */
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  /**
   * Direct video-generation provider key (Phase 8). Optional: video
   * generation is opt-in per story and off by default, so most deployments
   * never call it. `media-gateway.ts`'s `generateVideo` is the only consumer.
   */
  VIDEO_PROVIDER_API_KEY: z.string().min(1).optional(),
  VIDEO_PROVIDER_BASE_URL: z.string().url().optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, source: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid ${label} environment configuration:\n${details}\n\nSee apps/web/.env.example.`,
    );
  }

  return result.data;
}

/**
 * Client-safe environment. Referenced explicitly rather than via a loop,
 * because Next.js inlines NEXT_PUBLIC_* vars only on literal member access.
 */
export const clientEnv = parse(
  clientSchema,
  {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  'client',
);

let cachedServerEnv: z.infer<typeof serverSchema> | undefined;

/**
 * Server-only environment. Lazily parsed so that importing this module from a
 * client component does not throw on vars the client can never see.
 */
export function serverEnv(): z.infer<typeof serverSchema> {
  if (cachedServerEnv === undefined) {
    cachedServerEnv = parse(serverSchema, process.env, 'server');
  }

  return cachedServerEnv;
}
