import { redirect } from 'next/navigation';

import { getUser } from '@/lib/auth';
import { LandingPage } from '@/app/landing-page';

export default async function Home() {
  const user = await getUser();

  if (user !== null) {
    redirect('/stories');
  }

  return <LandingPage />;
}
