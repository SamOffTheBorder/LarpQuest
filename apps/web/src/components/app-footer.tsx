import Link from 'next/link';

export function AppFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-4 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <Link href="/terms" className="hover:text-foreground hover:underline">
          Terms of Service
        </Link>
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          Privacy Policy
        </Link>
        <Link href="/acceptable-use" className="hover:text-foreground hover:underline">
          Acceptable Use Policy
        </Link>
      </div>
    </footer>
  );
}
