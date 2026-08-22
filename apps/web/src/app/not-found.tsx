import { ErrorState } from '@/components/error-state';

/**
 * Shown for an unmatched URL, and by any `notFound()` call that no nearer
 * boundary handles.
 */
export default function NotFound() {
  return (
    <ErrorState
      title="Page not found"
      description="That page does not exist. It may have been removed, or the link may be wrong. If you were following a share link, ask whoever sent it whether it is still active."
    />
  );
}
