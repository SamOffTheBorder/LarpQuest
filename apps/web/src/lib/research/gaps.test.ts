import { describe, expect, it } from 'vitest';

import { buildGapsReport } from '@/lib/research/gaps';
import type { DraftDocument } from '@/lib/research/draft';

describe('buildGapsReport', () => {
  it('collects low-confidence facts across multiple sections, ignoring high/medium ones', () => {
    const draft: DraftDocument = {
      auMarks: [],
      scoping: {
        status: 'accepted',
        content: {
          media_type: { value: 'manga', confidence: 'high' },
          scale_ceiling: { value: 'unclear', confidence: 'low' },
        } as never,
      },
      timeline: {
        status: 'accepted',
        content: {
          starting_point: { value: 'guessed', confidence: 'low', source: undefined },
          unresolved_threads: { value: ['a', 'b'], confidence: 'medium' },
        } as never,
      },
    };

    const report = buildGapsReport(draft, []);

    expect(report.low_confidence_facts).toHaveLength(2);
    expect(report.low_confidence_facts).toContainEqual({
      section: 'scoping',
      path: 'scale_ceiling',
      value: 'unclear',
      source: undefined,
    });
    expect(report.low_confidence_facts).toContainEqual({
      section: 'timeline',
      path: 'starting_point',
      value: 'guessed',
      source: undefined,
    });
  });

  it('finds low-confidence facts nested inside arrays', () => {
    const draft: DraftDocument = {
      auMarks: [],
      entities: {
        status: 'pending',
        content: {
          entities: [
            {
              name: 'Character A',
              role: { value: 'protagonist', confidence: 'high' },
              capabilities: { value: [], confidence: 'low', source: 'inferred' },
            },
          ],
        } as never,
      },
    };

    const report = buildGapsReport(draft, []);

    expect(report.low_confidence_facts).toEqual([
      {
        section: 'entities',
        path: 'entities[0].capabilities',
        value: [],
        source: 'inferred',
      },
    ]);
  });

  it('explicitly lists failed and skipped stages as unresolved', () => {
    const report = buildGapsReport(
      { auMarks: [] },
      [
        { stage: 'progression', status: 'skipped' },
        { stage: 'entities', status: 'failed', lastError: 'model returned invalid JSON twice' },
        { stage: 'scoping', status: 'complete' },
      ],
    );

    expect(report.unresolved_stages).toEqual([
      { stage: 'progression', status: 'skipped', reason: undefined },
      { stage: 'entities', status: 'failed', reason: 'model returned invalid JSON twice' },
    ]);
  });

  it('returns an empty report for a draft with only high-confidence, complete stages', () => {
    const draft: DraftDocument = {
      auMarks: [],
      scoping: {
        status: 'accepted',
        content: { media_type: { value: 'novel', confidence: 'high' } } as never,
      },
    };

    const report = buildGapsReport(draft, [{ stage: 'scoping', status: 'complete' }]);

    expect(report.low_confidence_facts).toEqual([]);
    expect(report.unresolved_stages).toEqual([]);
  });
});
