import { redirect } from 'next/navigation';

import { getUser } from '@/lib/auth';
import { SignInForm } from '@/app/sign-in/sign-in-form';

export default async function SignInPage() {
  const user = await getUser();

  if (user !== null) {
    redirect('/stories');
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignInForm />
    </main>
  );
}
