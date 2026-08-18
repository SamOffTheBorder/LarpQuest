'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  acceptSectionAction,
  editSectionAction,
  markFactAsAuAction,
  rejectSectionAction,
  type ReviewActionState,
} from '@/app/universes/[draftId]/review/actions';
import { HouseRuleForm } from '@/app/universes/[draftId]/review/house-rule-form';
import { RerunDiff } from '@/app/universes/[draftId]/review/rerun-diff';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { DraftDocument, DraftSectionKey } from '@/lib/research/draft';
import type { ResearchStage } from '@/lib/research/schemas';

/**
 * Every fact wrapper (`{ value, confidence, source? }`) renders the same way
 * regardless of which of the eight stage schemas it came from — the same
 * generic-dispatch idea `gaps.ts` uses for scanning, applied here for display.
 * Editing goes through a raw-JSON textarea rather than a bespoke form per
 * section, matching the schema-composite convention Phase 2's field renderer
 * already established for structured types with no natural single control.
 */

const SECTION_TO_STAGE: Record<DraftSectionKey, ResearchStage | null> = {
  scoping: 'scoping',
  rulesMechanics: 'rules_mechanics',
  progression: 'progression',
  entities: 'entities',
  timeline: 'timeline',
  schemaDerivation: 'schema_derivation',
  rulePack: 'rule_pack',
  gaps: null, // derived, not individually re-runnable
};

function isFactShaped(value: unknown): value is { value: unknown; confidence: string; source?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'confidence' in value &&
    typeof (value as { confidence: unknown }).confidence === 'string'
  );
}

const CONFIDENCE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  high: 'default',
  medium: 'secondary',
  low: 'destructive',
};

function FactValue({ node, path }: { node: unknown; path: string }) {
  if (isFactShaped(node)) {
    return (
      <div className="flex flex-wrap items-center gap-2 py-1" data-fact-path={path}>
        <span className="text-sm">{JSON.stringify(node.value)}</span>
        <Badge variant={CONFIDENCE_VARIANT[node.confidence] ?? 'secondary'}>{node.confidence}</Badge>
        {node.source !== undefined && (
          <span className="text-xs text-muted-foreground">source: {node.source}</span>
        )}
      </div>
    );
  }

  if (Array.isArray(node)) {
    return (
      <ul className="flex flex-col gap-1 border-l pl-3">
        {node.map((item, index) => (
          <li key={index}>
            <FactValue node={item} path={`${path}[${index}]`} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof node === 'object' && node !== null) {
    return (
      <dl className="flex flex-col gap-1">
        {Object.entries(node).map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
            <dd>
              <FactValue node={value} path={path.length > 0 ? `${path}.${key}` : key} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span className="text-sm">{String(node)}</span>;
}

export function SectionReview({
  draftId,
  sectionKey,
  label,
  document,
  previousOutput,
}: {
  draftId: string;
  sectionKey: DraftSectionKey;
  label: string;
  document: DraftDocument;
  previousOutput: unknown;
}) {
  const section = document[sectionKey];
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [auPath, setAuPath] = useState('');

  const initialAuState: ReviewActionState = { status: 'idle' };
  const [auState, auAction, auPending] = useActionState(
    markFactAsAuAction.bind(null, draftId, sectionKey, auPath),
    initialAuState,
  );

  if (section === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not started yet.</p>
        </CardContent>
      </Card>
    );
  }

  const displayed = section.status === 'edited' ? (section.editedContent ?? section.content) : section.content;
  const stage = SECTION_TO_STAGE[sectionKey];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{label}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={section.status === 'rejected' ? 'destructive' : 'outline'}>{section.status}</Badge>
          {stage !== null && <RerunDiff draftId={draftId} stage={stage} currentOutput={displayed} previousOutput={previousOutput} />}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      const parsed: unknown = JSON.parse(editValue);
                      await editSectionAction(draftId, sectionKey, parsed);
                      setEditing(false);
                    } catch {
                      // Invalid JSON — left in the textarea for the user to fix.
                    }
                  })
                }
              >
                Save edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <FactValue node={displayed} path="" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={isPending || editing}
            onClick={() => startTransition(() => acceptSectionAction(draftId, sectionKey))}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending || editing}
            onClick={() => {
              setEditValue(JSON.stringify(displayed, null, 2));
              setEditing(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending || editing}
            onClick={() => startTransition(() => rejectSectionAction(draftId, sectionKey))}
          >
            Reject
          </Button>
        </div>

        <form action={auAction} className="flex flex-wrap items-center gap-2 border-t pt-3">
          <input
            className="w-32 rounded border px-2 py-1 text-xs"
            placeholder="field path (e.g. media_type)"
            value={auPath}
            onChange={(event) => setAuPath(event.target.value)}
          />
          <input
            name="divergenceNote"
            className="flex-1 rounded border px-2 py-1 text-xs"
            placeholder="Divergence note…"
          />
          <Button size="sm" variant="outline" type="submit" disabled={auPending || auPath.length === 0}>
            Mark as AU
          </Button>
          {auState.status === 'error' && <p className="w-full text-xs text-destructive">{auState.message}</p>}
        </form>

        {sectionKey === 'rulePack' && <HouseRuleForm draftId={draftId} />}
      </CardContent>
    </Card>
  );
}
