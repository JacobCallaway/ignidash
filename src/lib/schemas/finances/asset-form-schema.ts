import { z } from 'zod';
import { PiggyBankIcon, TrendingUpIcon, HouseIcon, CarIcon, CoinsIcon, FileQuestionMarkIcon } from 'lucide-react';

import { currencyFieldAllowsZero } from '@/lib/utils/zod-utils';
import { AVAILABLE_COUNTRIES, getCountryConfig } from '@/lib/country';

export const PHYSICAL_ASSET_TYPES = ['realEstate', 'vehicle', 'preciousMetals', 'other'] as const;
export type PhysicalAssetType = (typeof PHYSICAL_ASSET_TYPES)[number];

const PHYSICAL_ASSET_LABELS: Record<string, string> = {
  realEstate: 'Real Estate',
  vehicle: 'Vehicle',
  preciousMetals: 'Precious Metals',
  other: 'Other Asset',
};

export const assetFormSchema = z.object({
  id: z.string(),
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters'),
  value: currencyFieldAllowsZero('Value cannot be negative'),
  updatedAt: z.number(),
  url: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        try {
          const parsed = new URL(val);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Must be a valid http:// or https:// URL' }
    ),
  country: z.string().optional(),
  type: z.string(),
});

export type AssetInputs = z.infer<typeof assetFormSchema>;

export const assetTypeForDisplay = (type: string): string => {
  if (PHYSICAL_ASSET_LABELS[type]) return PHYSICAL_ASSET_LABELS[type];
  for (const { code } of AVAILABLE_COUNTRIES) {
    const found = getCountryConfig(code).accountTypes.find((t) => t.id === type);
    if (found) return found.label;
  }
  return type;
};

export const assetIconForDisplay = (
  type: string
): React.ForwardRefExoticComponent<
  React.PropsWithoutRef<React.SVGProps<SVGSVGElement>> & { title?: string; titleId?: string } & React.RefAttributes<SVGSVGElement>
> => {
  switch (type) {
    case 'realEstate':
      return HouseIcon;
    case 'vehicle':
      return CarIcon;
    case 'preciousMetals':
      return CoinsIcon;
    case 'other':
      return FileQuestionMarkIcon;
    default: {
      for (const { code } of AVAILABLE_COUNTRIES) {
        const config = getCountryConfig(code);
        const found = config.accountTypes.find((t) => t.id === type);
        if (found) return found.taxCategory === 'cashSavings' ? PiggyBankIcon : TrendingUpIcon;
      }
      return FileQuestionMarkIcon;
    }
  }
};
