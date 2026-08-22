import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title: string;
  description: string;
  /**
   * Rendered under the description when present. The framework only supplies a
   * digest in production — the message itself is withheld, so there is nothing
   * useful to show unless one exists.
   */
  digest?: string | undefined;
  /** Omitted by `not-found`, which has nothing to retry. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  homeHref?: string | undefined;
  homeLabel?: string | undefined;
}

/**
 * Shared presentation for the error, not-found, and crash boundaries.
 *
 * These are the screens a user sees when something has already gone wrong, so
 * they say what happened and offer a way out rather than apologising. The
 * error text itself is never rendered: a thrown error can carry a database
 * message or a prompt fragment, and this component is reachable by anyone.
 */
export function ErrorState({
  title,
  description,
  digest,
  onRetry,
  retryLabel = 'Try again',
  homeHref = '/stories',
  homeLabel = 'Back to your stories',
}: ErrorStateProps) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 p-4 text-center sm:p-6">
      <h1 className="font-heading text-xl font-semibold sm:text-2xl">{title}</h1>
      <p className="max-w-prose text-muted-foreground">{description}</p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry !== undefined && (
          <button type="button" onClick={onRetry} className={cn(buttonVariants())}>
            {retryLabel}
          </button>
        )}
        <Link href={homeHref} className={buttonVariants({ variant: 'outline' })}>
          {homeLabel}
        </Link>
      </div>

      {digest !== undefined && (
        <p className="text-xs text-muted-foreground">
          Reference code: <code className="font-mono">{digest}</code>
        </p>
      )}
    </main>
  );
}
