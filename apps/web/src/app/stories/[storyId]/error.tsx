'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

import { ErrorState } from '@/components/error-state';

/**
 * Story-scoped boundary. Sits nearer than the root one so a failure inside a
 * single story does not blank the rest of the app, and so the copy can be
 * specific about what is and is not at risk — published chapters and
 * submissions are durable regardless of what failed to render.
 */
export default function StoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="This story could not be loaded"
      description="Something went wrong reading the story. Nothing has been lost — published chapters and submitted turns are stored independently of this page."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
