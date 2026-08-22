import { requireUser } from '@/lib/auth';
import { DeleteAccountForm } from '@/app/settings/account/delete-account-form';

export default async function AccountSettingsPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">Account</h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.email}.</p>
      </div>

      <div className="rounded-lg border border-destructive/30 p-4">
        <h2 className="font-medium text-destructive">Delete account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile, email, and API keys are permanently removed. Chapters you helped write
          stay part of any story you shared with others — this deletes your account, not their
          story. This cannot be undone.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          If you are the sole owner of any story, you will need to transfer ownership from that
          story&apos;s Members page first.
        </p>
        <DeleteAccountForm />
      </div>
    </main>
  );
}
