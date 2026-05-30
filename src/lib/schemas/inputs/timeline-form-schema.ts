/**
 * Timeline and retirement strategy schema with cross-field validation.
 *
 * Defines birth date, life expectancy, and retirement strategy (fixed age or
 * SWR target). Includes validation ensuring retirement age < life expectancy.
 */

import { z } from 'zod';

import { ageField, percentageField } from '@/lib/utils/zod-utils';

export const retirementStrategySchema = z.discriminatedUnion('type', [
  z.object({
    retirementAge: ageField(19, 73, {
      min: 'Retirement age must be at least 19 years',
      max: 'Retirement age must be at most 73 years',
    }),
    type: z.literal('fixedAge'),
  }),
  z.object({
    safeWithdrawalRate: percentageField(2, 6, 'Safe withdrawal rate'),
    type: z.literal('swrTarget'),
  }),
  z.object({
    type: z.literal('earliestPossible'),
  }),
]);

export const timelineFormSchema = z
  .object({
    birthMonth: z.number().int().min(1).max(12),
    birthYear: z.number().int().min(1925).max(2025),
    lifeExpectancy: ageField(50, 110, {
      min: 'Life expectancy must be at least 50 years',
      max: 'Life expectancy must be at most 110 years',
    }),
    retirementStrategy: retirementStrategySchema,
    spouseBirthMonth: z.number().int().min(1).max(12).optional(),
    spouseBirthYear: z.number().int().min(1925).max(2025).optional(),
    spouseLifeExpectancy: ageField(50, 110, {
      min: 'Spouse life expectancy must be at least 50 years',
      max: 'Spouse life expectancy must be at most 110 years',
    }).optional(),
  })
  .refine(
    (data) => {
      const currentAge = calculateAge(data.birthMonth, data.birthYear);
      return currentAge >= 18 && currentAge <= 100;
    },
    {
      message: 'You must be between 18 and 100 years old',
      path: ['birthYear'],
    }
  )
  .refine(
    (data) => {
      const currentAge = calculateAge(data.birthMonth, data.birthYear);
      return currentAge < data.lifeExpectancy;
    },
    {
      message: 'Life expectancy must be greater than current age',
      path: ['lifeExpectancy'],
    }
  )
  .refine(
    (data) => {
      if (data.retirementStrategy.type !== 'fixedAge') return true;
      const currentAge = calculateAge(data.birthMonth, data.birthYear);
      return currentAge <= data.retirementStrategy.retirementAge && data.retirementStrategy.retirementAge < data.lifeExpectancy;
    },
    {
      message: 'Retirement age must be between current age and life expectancy',
      path: ['retirementStrategy', 'retirementAge'],
    }
  )
  .refine(
    (data) => {
      const hasMonth = data.spouseBirthMonth !== undefined;
      const hasYear = data.spouseBirthYear !== undefined;
      return hasMonth === hasYear;
    },
    {
      message: 'Both spouse birth month and year are required',
      path: ['spouseBirthYear'],
    }
  );

export type RetirementStrategyInputs = z.infer<typeof retirementStrategySchema>;
export type TimelineInputs = z.infer<typeof timelineFormSchema>;

export function calculateAge(birthMonth: number, birthYear: number): number {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  let age = currentYear - birthYear;
  if (currentMonth < birthMonth) {
    age--;
  }
  return age;
}

export function calculatePreciseAge(birthMonth: number, birthYear: number): number {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const yearDiff = currentYear - birthYear;
  const monthDiff = currentMonth - birthMonth;

  return yearDiff + monthDiff / 12;
}
