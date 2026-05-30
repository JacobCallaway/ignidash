import { v } from 'convex/values';

export const timelineValidator = v.object({
  birthMonth: v.number(),
  birthYear: v.number(),
  lifeExpectancy: v.number(),
  retirementStrategy: v.union(
    v.object({ type: v.literal('fixedAge'), retirementAge: v.number() }),
    v.object({ type: v.literal('swrTarget'), safeWithdrawalRate: v.number() }),
    v.object({ type: v.literal('earliestPossible') })
  ),
  spouseBirthMonth: v.optional(v.number()),
  spouseBirthYear: v.optional(v.number()),
  spouseLifeExpectancy: v.optional(v.number()),
});
