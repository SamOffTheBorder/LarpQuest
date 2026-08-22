/**
 * Given every `owner`-role membership row across the stories this user owns,
 * pick out the story ids where they are the *only* owner.
 *
 * Free of I/O so this decision is testable without a database — the same
 * separation `lib/ai/budget.ts` uses for spend caps. Kept in its own module,
 * not alongside the I/O that calls it in `account-deletion.ts`, because that
 * module imports the service-role Supabase client and this one must not: a
 * pure function sharing a file with an I/O import pulls the whole chain in
 * regardless of which export a caller actually uses.
 *
 * A story with two owners (not currently reachable through the app, but not
 * forbidden by the schema either) does not block deletion: the other owner
 * inherits sole ownership automatically the moment this user's row is gone.
 */
export function soleOwnedStoryIds(
  userId: string,
  ownerRowsForCandidateStories: { storyId: string; userId: string }[],
): string[] {
  const byStory = new Map<string, string[]>();
  for (const row of ownerRowsForCandidateStories) {
    const owners = byStory.get(row.storyId) ?? [];
    owners.push(row.userId);
    byStory.set(row.storyId, owners);
  }

  return [...byStory.entries()]
    .filter(([, owners]) => owners.length === 1 && owners[0] === userId)
    .map(([storyId]) => storyId);
}
