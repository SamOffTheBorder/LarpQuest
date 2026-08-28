'use client';

import { useActionState, useState } from 'react';

import {
  createStoryAction,
  generatePremiseAction,
  type CreateStoryState,
} from '@/app/stories/new/actions';
import { CONTENT_RATINGS } from '@/lib/engine/content-ratings';
import { MAX_CAST_SIZE, MIN_CAST_SIZE } from '@/lib/engine/premise-schema';
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
import { Textarea } from '@/components/ui/textarea';

/**
 * Story creation, step one: what kind of story does the GM want?
 *
 * Every field here is open text or a number. There is deliberately no genre
 * or media-type picker — the guidance comes from what each field asks and its
 * placeholder, not from a menu of answers, so no genre token ever reaches the
 * engine (CLAUDE.md constraint #1).
 *
 * Two submit paths share the form: generate a premise, or skip straight to a
 * blank story. Skipping needs a title, so it reveals one rather than
 * inventing something from the pitch.
 */

const initialState: CreateStoryState = { status: 'idle' };

const RATING_LABELS: Record<(typeof CONTENT_RATINGS)[number], string> = {
  everyone: 'Everyone',
  teen: 'Teen',
  mature: 'Mature',
};

export function IntentForm() {
  const [state, action, pending] = useActionState(generatePremiseAction, initialState);
  const [skipState, skipAction, skipPending] = useActionState(createStoryAction, initialState);
  const [showMore, setShowMore] = useState(false);
  const [skipping, setSkipping] = useState(false);

  if (skipping) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Start a blank story</CardTitle>
          <CardDescription>
            No premise, no cast — just an empty story you fill in yourself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={skipAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="title"
                name="title"
                placeholder="The Sunken Archive"
                required
                maxLength={200}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="skipContentRating" className="text-sm font-medium">
                Content rating
              </label>
              <Select name="contentRating" defaultValue="teen">
                <SelectTrigger id="skipContentRating" className="w-full">
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
              <label htmlFor="skipUniverseId" className="text-sm font-medium">
                Universe (optional)
              </label>
              <Input
                id="skipUniverseId"
                name="universeId"
                placeholder="Universe ID — leave blank for freeform"
              />
            </div>

            {skipState.status === 'error' && (
              <p className="text-sm text-destructive">{skipState.message}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={skipPending}>
                {skipPending ? 'Creating…' : 'Create story'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSkipping(false)}>
                Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Start a new story</CardTitle>
        <CardDescription>
          Describe what you want and we&apos;ll draft a premise — a setting, an opening
          situation, and a starting cast. You keep what works and re-roll what doesn&apos;t.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pitch" className="text-sm font-medium">
              What kind of story do you want?
            </label>
            <Textarea
              id="pitch"
              name="pitch"
              rows={4}
              maxLength={2000}
              placeholder="A heist that goes wrong in the first ninety seconds. Morally grey crew, nobody's a hero."
            />
            <p className="text-xs text-muted-foreground">
              Anything goes — a mood, a premise, a single image. The more specific you are,
              the less generic the result.
            </p>
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

          <button
            type="button"
            onClick={() => setShowMore((open) => !open)}
            className="self-start text-sm font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showMore}
          >
            {showMore ? '▾' : '▸'} More options
          </button>

          {showMore && (
            <div className="flex flex-col gap-3 border-l pl-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settingSketch" className="text-sm font-medium">
                  Setting
                </label>
                <Textarea
                  id="settingSketch"
                  name="settingSketch"
                  rows={2}
                  maxLength={1000}
                  placeholder="A vertical city in perpetual rain, built on the bones of an older one."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="toneNotes" className="text-sm font-medium">
                  Tone
                </label>
                <Textarea
                  id="toneNotes"
                  name="toneNotes"
                  rows={2}
                  maxLength={1000}
                  placeholder="Wry and tense. Never grim for its own sake."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="mustInclude" className="text-sm font-medium">
                  Must include
                </label>
                <Textarea
                  id="mustInclude"
                  name="mustInclude"
                  rows={2}
                  maxLength={1000}
                  placeholder="A getaway that fails. A debt nobody talks about."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="mustAvoid" className="text-sm font-medium">
                  Must avoid
                </label>
                <Textarea
                  id="mustAvoid"
                  name="mustAvoid"
                  rows={2}
                  maxLength={1000}
                  placeholder="Chosen-one framing. Prophecies."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="castSize" className="text-sm font-medium">
                  Starting cast size
                </label>
                <Input
                  id="castSize"
                  name="castSize"
                  type="number"
                  min={MIN_CAST_SIZE}
                  max={MAX_CAST_SIZE}
                  defaultValue={3}
                  className="w-24"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="universeId" className="text-sm font-medium">
                  Universe
                </label>
                <Input
                  id="universeId"
                  name="universeId"
                  placeholder="Universe ID — leave blank for freeform"
                />
                <p className="text-xs text-muted-foreground">
                  Pins this story to that universe&apos;s schema and progression model, and
                  writes the premise to sit inside its canon.
                </p>
              </div>
            </div>
          )}

          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Writing a premise…' : 'Generate premise'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSkipping(true)}>
              Skip and start blank
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
