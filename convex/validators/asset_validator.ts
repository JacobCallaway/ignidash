import { v } from 'convex/values';

export const assetValidator = v.object({
  id: v.string(),
  name: v.string(),
  value: v.number(),
  updatedAt: v.number(),
  url: v.optional(v.string()),
  country: v.optional(v.string()),
  type: v.string(),
});
