import type { DraftDocument, DraftSectionKey } from '@/lib/research/draft';
import type { GapsResult } from '@/lib/research/schemas';

/**
 * Stage 8 — Confidence & Gaps Report.
 *
 * Unlike Stages 1–7, this is not a model call: it aggregates what the other
 * stages already produced. Every fact wrapper (`{ value, confidence, source? }`)
 * is the same shape across every stage's schema (schemas.ts's `fact()`
 * helper), so this can walk any section generically rather than needing a
 * per-section case — the gaps report scales to a ninth stage's schema without
 * this file changing, as long as that stage also uses `fact()`.
 */

interface JobStatusInput {
  stage: string;
  status: 'complete' | 'failed' | 'skipped' | 'queued' | 'running';
  lastError?: string | undefined;
}

function isFactShaped(value: unknown): value is { value: unknown; confidence: string; source?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'confidence' in value &&
    typeof (value as { confidence: unknown }).confidence === 'string'
  );
}

function collectLowConfidenceFacts(
  node: unknown,
  section: string,
  path: string,
  out: GapsResult['low_confidence_facts'],
): void {
  if (isFactShaped(node)) {
    if (node.confidence === 'low') {
      out.push({ section, path, value: node.value, source: node.source });
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => collectLowConfidenceFacts(item, section, `${path}[${index}]`, out));
    return;
  }

  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      collectLowConfidenceFacts(value, section, path.length > 0 ? `${path}.${key}` : key, out);
    }
  }
}

const SECTION_LABELS: Record<Exclude<DraftSectionKey, 'gaps'>, string> = {
  scoping: 'scoping',
  rulesMechanics: 'rulesMechanics',
  progression: 'progression',
  entities: 'entities',
  timeline: 'timeline',
  schemaDerivation: 'schemaDerivation',
  rulePack: 'rulePack',
};

export function buildGapsReport(draft: DraftDocument, jobs: readonly JobStatusInput[]): GapsResult {
  const lowConfidenceFacts: GapsResult['low_confidence_facts'] = [];

  for (const [key, label] of Object.entries(SECTION_LABELS) as [
    Exclude<DraftSectionKey, 'gaps'>,
    string,
  ][]) {
    const sectionValue = draft[key];
    if (sectionValue === undefined) {
      continue;
    }
    collectLowConfidenceFacts(sectionValue.content, label, '', lowConfidenceFacts);
  }

  const unresolvedStages = jobs
    .filter((job) => job.status === 'failed' || job.status === 'skipped')
    .map((job) => ({
      stage: job.stage,
      status: job.status as 'failed' | 'skipped',
      reason: job.lastError,
    }));

  return {
    low_confidence_facts: lowConfidenceFacts,
    unresolved_stages: unresolvedStages,
  };
}
