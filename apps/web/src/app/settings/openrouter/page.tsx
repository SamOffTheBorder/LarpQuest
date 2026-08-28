import { decryptSecret } from '@/lib/crypto';
import { getUserApiKey } from '@/lib/ai/api-key';
import { requireUser } from '@/lib/auth';
import { OpenRouterKeyForm } from '@/app/settings/openrouter/openrouter-key-form';

/**
 * Where a user saves their own OpenRouter key. Any story they run as GM (or
 * own, if no GM is assigned) bills that key instead of the platform's. The
 * decrypted key is used only to compute the last-4 fingerprint here and is
 * never sent to the client.
 */
export default async function OpenRouterSettingsPage() {
  const user = await requireUser();
  const stored = await getUserApiKey(user.id);

  let fingerprint: string | null = null;
  if (stored !== null) {
    try {
      fingerprint = decryptSecret(stored.encryptedKey).slice(-4);
    } catch {
      // Row unreadable (rotated master key). Treat as "has a key" with an
      // opaque marker so the user can replace it.
      fingerprint = '????';
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">OpenRouter</h1>
        <p className="text-sm text-muted-foreground">
          Bring your own OpenRouter account. When you are the GM of a story, its generation runs on
          your key and your models. Without a key here, stories fall back to the platform key.
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">API key</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Costs are still recorded per story, since OpenRouter reports them — this only changes which
          account the spend lands on.
        </p>
        <OpenRouterKeyForm fingerprint={fingerprint} savedAt={stored?.createdAt ?? null} />
      </div>
    </main>
  );
}
