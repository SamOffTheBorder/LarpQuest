import { IntentForm } from '@/app/stories/new/intent-form';
import { requireUser } from '@/lib/auth';

export default async function NewStoryPage() {
  await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <IntentForm />
    </main>
  );
}
