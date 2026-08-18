'use client';

import { useActionState } from 'react';

import { createStoryAction, type CreateStoryState } from '@/app/stories/new/actions';
import { CONTENT_RATINGS } from '@/lib/engine/content-ratings';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const initialState: CreateStoryState = { status: 'idle' };

const RATING_LABELS: Record<(typeof CONTENT_RATINGS)[number], string> = {
  everyone: 'Everyone',
  teen: 'Teen',
  mature: 'Mature',
};

export function NewStoryForm() {
  const [state, action, pending] = useActionState(createStoryAction, initialState);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Start a new story</CardTitle>
        <CardDescription>You can change these later.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="title" className="text-sm font-medium">
              Title
            </label>
            <Input id="title" name="title" placeholder="The Sunken Archive" required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="contentRating" className="text-sm font-medium">
              Content rating
            </label>
            <Select name="contentRating" defaultValue="teen">
              <SelectTrigger id="contentRating" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_RATINGS.map((rating) => (
                  <SelectItem key={rating} value={rating}>
                    {RATING_LABELS[rating]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="universeId" className="text-sm font-medium">
              Universe (optional)
            </label>
            <Input id="universeId" name="universeId" placeholder="Universe ID — leave blank for freeform" />
            <p className="text-xs text-muted-foreground">
              Pins this story to that universe&apos;s current schema and progression model. Leave blank for an unconstrained, freeform story.
            </p>
          </div>

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create story'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
