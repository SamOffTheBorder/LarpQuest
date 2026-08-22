'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/error-state';

/**
 * Root error boundary. Catches anything thrown while rendering a route that
 * has no closer boundary of its own. Without this, a thrown error shows the
 * framework's raw error screen.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Nothing is wired to an error tracker yet; the console at least surfaces
    // it in local development and in the platform's runtime logs.
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      description="This page failed to load. The problem has been logged. Trying again often works — the story itself is unaffected."
      digest={error.digest}
      onRetry={reset}
    />
  );
}
