'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 *
 * This replaces the whole document, so unlike `error.tsx` it must render its
 * own <html> and <body> — and it cannot rely on the layout's providers, fonts,
 * or theme, which are exactly what may have failed. The markup is therefore
 * deliberately plain and self-contained rather than reusing ErrorState.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.5rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>StoryForge could not start</h1>
        <p style={{ maxWidth: '38rem', lineHeight: 1.6 }}>
          Something failed before the page could be rendered. Reloading usually resolves it. If it
          keeps happening, the deployment itself is likely misconfigured.
        </p>
        <button type="button" onClick={reset} style={{ textDecoration: 'underline' }}>
          Reload
        </button>
        {error.digest !== undefined && (
          <p style={{ fontSize: '0.75rem' }}>Reference code: {error.digest}</p>
        )}
      </body>
    </html>
  );
}
