'use client';

import { useState, useTransition } from 'react';

import {
  acceptSectionAction,
  editSectionAction,
  rejectSectionAction,
  setCastMemberKeptAction,
} from '@/app/stories/new/[draftId]/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  effectiveContent,
  type PremiseCastMember,
  type PremiseDocument,
  type PremiseSectionKey,
} from '@/lib/engine/premise-schema';

/**
 * Per-section review: keep what works, cut what doesn't.
 *
 * Unlike the universe review's JSON textarea, premise sections are prose the
 * GM reads and rewrites in their own words — so editing is plain text, and
 * the list-shaped sections (hooks, cast) edit one line per item.
 *
 * The cast is the exception that earns its own controls: it is a list of
 * independent characters, and cutting the whole section to remove one of them
 * would throw away the others (design.md decision 9).
 */

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  accepted: 'default',
  edited: 'secondary',
  rejected: 'destructive',
  pending: 'outline',
};

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Kept',
  edited: 'Edited',
  rejected: 'Cut',
  pending: 'Not reviewed',
};

function CastList({
  draftId,
  cast,
  disabled,
}: {
  draftId: string;
  cast: PremiseCastMember[];
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <ul className="flex flex-col gap-2">
      {cast.map((member, index) => (
        <li
          key={`${member.name}-${index}`}
          className="flex items-start justify-between gap-3 rounded border p-2"
        >
          <div className={member.kept ? '' : 'opacity-50'}>
            <p className={`text-sm font-medium ${member.kept ? '' : 'line-through'}`}>
              {member.name}
              <span className="ml-2 font-normal text-muted-foreground">
                {member.type} · {member.role}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{member.description}</p>
          </div>
          <Button
            size="sm"
            variant={member.kept ? 'outline' : 'secondary'}
            disabled={disabled || isPending}
            onClick={() =>
              startTransition(() => setCastMemberKeptAction(draftId, index, !member.kept))
            }
          >
            {member.kept ? 'Cut' : 'Restore'}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Render a section's content for reading. Lists render as lists. */
function SectionBody({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-5 text-sm">
        {value.map((item, index) => (
          <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    );
  }

  return <p className="whitespace-pre-wrap text-sm">{String(value)}</p>;
}

/** Text the GM edits: one line per item for lists, the prose itself otherwise. */
function toEditableText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : String(value);
}

function fromEditableText(text: string, wasArray: boolean): unknown {
  return wasArray
    ? text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : text.trim();
}

export function SectionReview({
  draftId,
  sectionKey,
  label,
  description,
  document,
}: {
  draftId: string;
  sectionKey: PremiseSectionKey;
  label: string;
  description: string;
  document: PremiseDocument;
}) {
  const section = document[sectionKey];
  const displayed = effectiveContent(document, sectionKey);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const isCast = sectionKey === 'cast';
  const isRejected = section.status === 'rejected';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{label}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant={STATUS_VARIANT[section.status] ?? 'outline'}>
          {STATUS_LABEL[section.status] ?? section.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              rows={Array.isArray(displayed) ? 6 : 5}
            />
            {Array.isArray(displayed) && !isCast && (
              <p className="text-xs text-muted-foreground">One per line.</p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await editSectionAction(
                      draftId,
                      sectionKey,
                      fromEditableText(editValue, Array.isArray(displayed)),
                    );
                    setEditing(false);
                  })
                }
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={isRejected ? 'opacity-50' : ''}>
            {isCast ? (
              <CastList
                draftId={draftId}
                cast={displayed as PremiseCastMember[]}
                disabled={isRejected}
              />
            ) : (
              <SectionBody value={displayed} />
            )}
          </div>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={section.status === 'accepted' ? 'default' : 'outline'}
              disabled={isPending}
              onClick={() => startTransition(() => acceptSectionAction(draftId, sectionKey))}
            >
              Keep
            </Button>
            {!isCast && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setEditValue(toEditableText(displayed));
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            )}
            <Button
              size="sm"
              variant={isRejected ? 'secondary' : 'outline'}
              disabled={isPending}
              onClick={() =>
                startTransition(() =>
                  isRejected
                    ? acceptSectionAction(draftId, sectionKey)
                    : rejectSectionAction(draftId, sectionKey),
                )
              }
            >
              {isRejected ? 'Undo cut' : 'Cut'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
