import Link from 'next/link';

import { StoryForgeMark } from '@/components/storyforge-mark';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PILLARS = [
  {
    title: 'State is permanent, prose is disposable',
    body: 'Every chapter is generated from a structured record of your entities, relationships, and world facts — not from the AI trying to remember what it wrote 80 chapters ago. That record updates after every chapter, so a long-running campaign stays as coherent at chapter 100 as it was at chapter 5.',
  },
  {
    title: 'Any universe, the same engine',
    body: 'Describe an existing franchise or an original setting and the research pipeline builds a canon bible — rules, power systems, timeline, cast — for you to review and correct before play starts. Nothing in the engine hardcodes genre: a superhero war, a locked-room mystery, and a courtroom drama all run on the same rules.',
  },
  {
    title: 'Built for a table, not a chatbot window',
    body: 'Invite players into a story with real roles (GM, player, spectator), claimed entities, turn deadlines, and a validator that catches continuity breaks before they publish. A rejected power grab gets an in-universe explanation from a gatekeeper, not a silent refusal.',
  },
];

const TURN_MODES = [
  'Action',
  'Scene',
  'Investigation',
  'Dialogue',
  'Montage',
  'Downtime',
];

export function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
        <StoryForgeMark className="size-14 text-primary" />
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Collaborative fiction that remembers everything.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          StoryForge is an AI game master for long-running, multiplayer stories in any
          universe you choose. It tracks state like a real GM, not a chat log — so your
          campaign is still coherent a hundred chapters in.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-in" className={buttonVariants({ size: 'lg' })}>
            Sign in to start a story
          </Link>
          <Link
            href="/universes/marketplace"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            Browse universes
          </Link>
        </div>
      </section>

      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-16 sm:grid-cols-3 sm:px-6">
          {PILLARS.map((pillar) => (
            <Card key={pillar.title} className="bg-background">
              <CardHeader>
                <CardTitle className="text-base">{pillar.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{pillar.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="font-heading text-xl font-semibold sm:text-2xl">
          One story, six ways to play a turn
        </h2>
        <p className="mt-2 text-muted-foreground">
          Every campaign can switch between turn modes mid-story, matched to what the scene
          actually needs — a fight resolves differently than a negotiation, and a mystery
          gates what players learn instead of just narrating it at them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {TURN_MODES.map((mode) => (
            <span
              key={mode}
              className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
            >
              {mode}
            </span>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
          <h2 className="font-heading text-xl font-semibold sm:text-2xl">
            Bring your own universe, or clone one
          </h2>
          <p className="max-w-xl text-muted-foreground">
            Published universes are open to browse and clone into your own story. Fork one,
            tweak it, and run your own version — or start from nothing and let the research
            pipeline build the bible for you.
          </p>
          <Link href="/sign-in" className={buttonVariants()}>
            Get started
          </Link>
        </div>
      </section>
    </main>
  );
}
