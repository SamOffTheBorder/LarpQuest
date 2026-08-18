'use client';

import { useActionState } from 'react';

import { addHouseRuleAction, type ReviewActionState } from '@/app/universes/[draftId]/review/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const initialState: ReviewActionState = { status: 'idle' };

export function HouseRuleForm({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState(addHouseRuleAction.bind(null, draftId), initialState);

  return (
    <form action={action} className="flex items-center gap-2 border-t pt-3">
      <Input name="ruleText" placeholder="Add a house rule…" className="flex-1" />
      <Button size="sm" type="submit" disabled={pending}>
        Add rule
      </Button>
      {state.status === 'error' && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
