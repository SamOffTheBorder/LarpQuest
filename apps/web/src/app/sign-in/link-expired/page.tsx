import { SignInForm } from '@/app/sign-in/sign-in-form';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LinkExpiredPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>That link didn&apos;t work</CardTitle>
          <CardDescription>
            It may have expired or already been used. Request a new one below.
          </CardDescription>
        </CardHeader>
      </Card>
      <SignInForm />
    </main>
  );
}
