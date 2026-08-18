'use client';

import { useActionState } from 'react';

import { createDraftAction, type NewDraftState } from '@/app/universes/new/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const initialState: NewDraftState = { status: 'idle' };

export function NewDraftForm() {
  const [state, action, pending] = useActionState(createDraftAction, initialState);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Research a new universe</CardTitle>
        <CardDescription>
          Type a name and the research pipeline builds a Canon Bible for you to review — usually
          in a few minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Universe name
            </label>
            <Input id="name" name="name" placeholder="Jujutsu Kaisen" required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="canonCutoff" className="text-sm font-medium">
              Canon cutoff (optional)
            </label>
            <Input id="canonCutoff" name="canonCutoff" placeholder="Anime only, or: manga through ch. 236" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="auNotes" className="text-sm font-medium">
              AU / divergence notes (optional)
            </label>
            <Textarea
              id="auNotes"
              name="auNotes"
              placeholder="This is an AU where X never happened…"
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sourceText" className="text-sm font-medium">
              Source material (optional)
            </label>
            <Textarea
              id="sourceText"
              name="sourceText"
              placeholder="Paste wiki text, notes, or reference material…"
              rows={4}
              maxLength={50_000}
            />
            <p className="text-xs text-muted-foreground">
              The research pipeline uses this as a starting point alongside its own research.
            </p>
          </div>

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? 'Starting research…' : 'Start research'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
