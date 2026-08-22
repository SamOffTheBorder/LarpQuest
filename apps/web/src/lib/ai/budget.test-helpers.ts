import type { BudgetGuard } from '@/lib/ai/gateway';

/**
 * A BudgetGuard that always allows. For tests exercising something other than
 * spend enforcement — the cap's own behaviour is covered in `budget.test.ts`.
 */
export const allowAllBudget: BudgetGuard = {
  async assertWithinBudget() {
    // Intentionally empty.
  },
};

/** A BudgetGuard that always refuses, for asserting a call never went out. */
export function denyingBudget(error: Error): BudgetGuard {
  return {
    async assertWithinBudget() {
      throw error;
    },
  };
}
