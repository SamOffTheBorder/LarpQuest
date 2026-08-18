import { serve } from 'inngest/next';

import { inngest } from '@/inngest/client';
import { rerunResearchStage } from '@/inngest/functions/rerun-research-stage';
import { runResearchPipeline } from '@/inngest/functions/run-research-pipeline';

/**
 * Inngest's serve handler — registers every function this app exposes.
 * Inngest Cloud (or the local Dev Server) calls back into this route to
 * invoke steps; the browser never calls it directly.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runResearchPipeline, rerunResearchStage],
});
