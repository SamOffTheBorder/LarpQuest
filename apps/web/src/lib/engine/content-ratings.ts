/**
 * Split out from `stories.ts` (which is `server-only`) so client components
 * can import the rating list for a <select> without pulling in server code.
 */
export const CONTENT_RATINGS = ['everyone', 'teen', 'mature'] as const;
