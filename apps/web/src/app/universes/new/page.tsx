import { NewDraftForm } from '@/app/universes/new/new-draft-form';
import { requireUser } from '@/lib/auth';

export default async function NewUniversePage() {
  await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <NewDraftForm />
    </main>
  );
}
