import { z } from 'zod';

export const planMetadataSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
    country: z.string().optional(),
    clonedPlanId: z.string().optional(),
    jsonImport: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.clonedPlanId !== 'jsonImport') return true;
      return data.jsonImport !== undefined && data.jsonImport.trim() !== '';
    },
    {
      message: 'You must paste some JSON to import',
      path: ['jsonImport'],
    }
  );

export type PlanMetadata = z.infer<typeof planMetadataSchema>;
