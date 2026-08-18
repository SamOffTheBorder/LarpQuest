import { Inngest } from 'inngest';

/**
 * The Inngest client.
 *
 * Introduced in Phase 3 for the research pipeline's multi-step orchestration
 * (design.md decision 2) — Phase 1's extraction_queue claim/update pattern is
 * kept as-is for its one-shot retryable job; it is not migrated to Inngest.
 *
 * In local dev, `npm run dev:inngest` runs the Inngest Dev Server via
 * `npx inngest-cli`, which this client auto-discovers with no signing key
 * required. Production requires INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY.
 *
 * Event payloads are typed at each call site (see
 * `ResearchDraftRequestedEvent` in `functions/run-research-pipeline.ts`)
 * rather than through the client's generic — this SDK version resolves event
 * types per-trigger via `eventType()`, not via a client-level schema map.
 */
export const inngest = new Inngest({ id: 'storyforge' });
