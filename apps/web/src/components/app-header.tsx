import Link from 'next/link';

import { getUser } from '@/lib/auth';
import { StoryForgeMark } from '@/components/storyforge-mark';
import { UserMenu } from '@/components/user-menu';
import { buttonVariants } from '@/components/ui/button';

export async function AppHeader() {
  const user = await getUser();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={user !== null ? '/stories' : '/'} className="flex items-center gap-2">
          <StoryForgeMark className="size-6 text-primary" />
          <span className="font-heading text-sm font-semibold tracking-wide text-foreground">
            StoryForge
          </span>
        </Link>
        {user !== null ? (
          <UserMenu email={user.email ?? 'Account'} />
        ) : (
          <Link href="/sign-in" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
