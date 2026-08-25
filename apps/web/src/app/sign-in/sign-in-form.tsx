'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signInAction, type SignInState } from '@/app/sign-in/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const initialState: SignInState = { status: 'idle' };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  if (state.status === 'sent') {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If that address has an account, a sign-in link is on its way. It expires soon and
            works once.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to StoryForge</CardTitle>
        <CardDescription>We&apos;ll email you a link — no password needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <Input
            type="email"
            name="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            aria-invalid={state.status === 'error'}
          />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="agreeToLegal" required className="mt-0.5" />
            <span>
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="underline">
                Terms of Service
              </Link>
              ,{' '}
              <Link href="/privacy" target="_blank" className="underline">
                Privacy Policy
              </Link>
              , and{' '}
              <Link href="/acceptable-use" target="_blank" className="underline">
                Acceptable Use Policy
              </Link>
              .
            </span>
          </label>
          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send magic link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
