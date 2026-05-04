import { v } from 'convex/values';

export const accountValidator = v.object({
  id: v.string(),
  name: v.string(),
  balance: v.number(),
  type: v.string(),
  percentBonds: v.optional(v.number()),
  costBasis: v.optional(v.number()),
  contributionBasis: v.optional(v.number()),
  syncedFinanceId: v.optional(v.string()),
});
