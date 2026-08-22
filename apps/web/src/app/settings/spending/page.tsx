import { DEFAULT_USER_CAP_USD } from '@/lib/ai/budget';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SpendCapForm } from '@/app/settings/spending/spend-cap-form';

/**
 * Where a user sets their own cap and sees what they have spent.
 *
 * Per-story caps live on the story itself rather than here — they belong to
 * the room, and the owner or GM sets them from story settings.
 */
export default async function SpendingSettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: prefs }, { data: usage }] = await Promise.all([
    supabase.from('user_preferences').select('spend_cap_usd').eq('user_id', user.id).maybeSingle(),
    supabase.from('usage_log').select('cost_usd').eq('user_id', user.id),
  ]);

  const spentUsd = (usage ?? []).reduce((total, row) => total + Number(row.cost_usd), 0);
  const capUsd = prefs?.spend_cap_usd == null ? null : Number(prefs.spend_cap_usd);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">Spending</h1>
        <p className="text-sm text-muted-foreground">
          Generation costs real money. This cap stops your account from spending past a limit
          you choose.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">Spent so far</p>
        <p className="font-heading text-2xl font-semibold">${spentUsd.toFixed(2)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          against a cap of ${(capUsd ?? DEFAULT_USER_CAP_USD).toFixed(2)}
          {capUsd === null && ' (the default)'}
        </p>
      </div>

      <SpendCapForm initialCapUsd={capUsd} defaultCapUsd={DEFAULT_USER_CAP_USD} />

      <p className="text-sm text-muted-foreground">
        Caps are checked before each generation against spend already recorded, so a call
        already in flight can carry you slightly past the limit. Treat the cap as a stop, not
        as an exact ceiling.
      </p>
    </main>
  );
}
