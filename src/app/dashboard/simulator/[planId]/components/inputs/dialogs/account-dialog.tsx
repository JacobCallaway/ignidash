'use client';

import { ConvexError } from 'convex/values';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUpIcon, InfoIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import posthog from 'posthog-js';

import { accountToConvex } from '@/lib/utils/data-transformers';
import { DialogTitle, DialogBody, DialogActions } from '@/components/catalyst/dialog';
import {
  buildAccountFormSchema,
  type AccountInputs,
  isRothAccount,
  taxCategoryFromAccountType,
  type RothAccountType,
} from '@/lib/schemas/inputs/account-form-schema';
import { assetTypeForDisplay, type AssetInputs } from '@/lib/schemas/finances/asset-form-schema';
import NumberInput from '@/components/ui/number-input';
import { Fieldset, FieldGroup, Field, Label, ErrorMessage } from '@/components/catalyst/fieldset';
import ErrorMessageCard from '@/components/ui/error-message-card';
import { Select } from '@/components/catalyst/select';
import { Button } from '@/components/catalyst/button';
import { Input } from '@/components/catalyst/input';
import { useSelectedPlanId } from '@/hooks/use-selected-plan-id';
import { useAlreadySyncedIds } from '@/hooks/use-already-synced-ids';
import { useLinkableFinances } from '@/hooks/use-linkable-finances';
import { getErrorMessages } from '@/lib/utils/form-utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { getCurrencySymbol, formatCurrencyPlaceholder } from '@/lib/utils/number-formatters';
import type { CountryConfig } from '@/lib/country/types';
import { getAccountTypeConfig } from '@/lib/country';

import SyncWithNetWorthTrackerSelect from './sync-with-nw-tracker-select';

const TAX_CATEGORY_LABELS: Record<string, string> = {
  cashSavings: 'Cash Savings Accounts',
  taxable: 'Taxable Accounts',
  taxDeferred: 'Tax-Deferred Accounts',
  taxFree: 'Tax-Free Accounts',
};

interface AccountDialogProps {
  onClose: () => void;
  selectedAccount: AccountInputs | null;
  accounts: Record<string, AccountInputs>;
  nwAssets: AssetInputs[] | null;
  countryConfig: CountryConfig;
}

export default function AccountDialog({
  onClose,
  selectedAccount: _selectedAccount,
  accounts,
  nwAssets,
  countryConfig,
}: AccountDialogProps) {
  const planId = useSelectedPlanId();
  const [selectedAccount] = useState(_selectedAccount);
  const numAccounts = Object.keys(accounts).length;

  // Only investment (non-cashSavings) types are shown in this dialog
  const investmentTypes = useMemo(() => countryConfig.accountTypes.filter((t) => t.taxCategory !== 'cashSavings'), [countryConfig]);

  const firstInvestmentTypeId = investmentTypes[0]?.id ?? '401k';

  const accountFormSchema = useMemo(() => buildAccountFormSchema(countryConfig), [countryConfig]);

  const linkableInvestmentTypes = useMemo(() => investmentTypes.map((t) => t.id) as AssetInputs['type'][], [investmentTypes]);

  const newAccountDefaultValues = useMemo(
    () =>
      ({
        name: 'Investment ' + (numAccounts + 1),
        id: '',
        type: firstInvestmentTypeId as AccountInputs['type'],
        percentBonds: 0,
      }) as const satisfies Partial<AccountInputs>,
    [numAccounts, firstInvestmentTypeId]
  );

  const defaultValues = (selectedAccount || newAccountDefaultValues) as never;

  const {
    register,
    unregister,
    control,
    handleSubmit,
    getFieldState,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(accountFormSchema),
    defaultValues,
  });

  const hasFormErrors = Object.keys(errors).length > 0;

  const m = useMutation(api.account.upsertAccount);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSubmit = async (data: AccountInputs) => {
    const processedData = { ...data };

    if (isRothAccount(data.type, countryConfig)) {
      const rothData = processedData as Extract<AccountInputs, { type: RothAccountType }>;
      rothData.contributionBasis ??= data.balance;
    }

    if (taxCategoryFromAccountType(data.type, countryConfig) === 'taxable') {
      (processedData as AccountInputs & { costBasis?: number }).costBasis ??= data.balance;
    }

    const accountId = processedData.id === '' ? uuidv4() : processedData.id;
    try {
      setSaveError(null);
      posthog.capture('save_account', { plan_id: planId, save_mode: selectedAccount ? 'edit' : 'create' });
      await m({ account: accountToConvex({ ...processedData, id: accountId }), planId });
      onClose();
    } catch (error) {
      setSaveError(error instanceof ConvexError ? error.message : 'Failed to save account.');
      console.error('Error saving account: ', error);
    }
  };

  const type = useWatch({ control, name: 'type' });
  const syncedFinanceId = useWatch({ control, name: 'syncedFinanceId' });
  const isSynced = !!syncedFinanceId;

  const alreadySyncedIds = useAlreadySyncedIds(accounts, 'syncedFinanceId', selectedAccount?.id);
  const linkableAssets = useLinkableFinances(nwAssets, alreadySyncedIds, linkableInvestmentTypes);

  const handleSyncChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const assetId = e.target.value;
    if (!assetId) {
      setValue('syncedFinanceId', undefined);
      return;
    }

    const asset = linkableAssets.find((a) => a.id === assetId);
    if (!asset) return;

    setValue('syncedFinanceId', asset.id);
    setValue('type', asset.type as AccountInputs['type']);
    setValue('balance', asset.value);
    setValue('name', asset.name);
  };

  const currentTypeConfig = useMemo(() => getAccountTypeConfig(countryConfig, type), [countryConfig, type]);
  const showCostBasis = currentTypeConfig?.hasCostBasis ?? false;
  const showContributionBasis = isRothAccount(type, countryConfig);

  useEffect(() => {
    if (!showContributionBasis) unregister('contributionBasis');
    if (!showCostBasis) unregister('costBasis');
  }, [showContributionBasis, showCostBasis, unregister]);

  const getBalanceColSpan = () => {
    if (showCostBasis || showContributionBasis) return 'col-span-1';
    return 'col-span-2';
  };

  const getNameColSpan = () => {
    if (linkableAssets.length === 0) return 'col-span-2';
    return 'col-span-1';
  };

  const { error: costBasisError } = getFieldState('costBasis');
  const { error: contributionBasisError } = getFieldState('contributionBasis');
  const { error: percentBondsError } = getFieldState('percentBonds');

  // Group investment types by tax category for the select optgroups
  const typesByCategory = useMemo(() => {
    const groups: Record<string, typeof investmentTypes> = {};
    for (const t of investmentTypes) {
      if (!groups[t.taxCategory]) groups[t.taxCategory] = [];
      groups[t.taxCategory].push(t);
    }
    return groups;
  }, [investmentTypes]);

  const categoryOrder = ['taxable', 'taxDeferred', 'taxFree'] as const;

  return (
    <>
      <DialogTitle onClose={onClose}>
        <div className="flex items-center gap-4">
          <TrendingUpIcon className="text-primary size-8 shrink-0" aria-hidden="true" />
          <span>{selectedAccount ? 'Edit Investment' : 'New Investment'}</span>
        </div>
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Fieldset aria-label="Account details">
          <DialogBody>
            <FieldGroup>
              {(saveError || hasFormErrors) && <ErrorMessageCard errorMessage={saveError || getErrorMessages(errors).join(', ')} />}
              <div className="grid grid-cols-2 gap-4">
                <Field className={getNameColSpan()}>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    {...register('name')}
                    id="name"
                    name="name"
                    placeholder="My Investment"
                    autoComplete="off"
                    inputMode="text"
                    invalid={!!errors.name}
                    aria-invalid={!!errors.name}
                    readOnly={isSynced}
                  />
                  {errors.name && <ErrorMessage>{errors.name?.message}</ErrorMessage>}
                </Field>
                <SyncWithNetWorthTrackerSelect
                  fieldId="syncedFinanceId"
                  options={linkableAssets.map((a) => ({ id: a.id, label: `${a.name} | ${assetTypeForDisplay(a.type)}` }))}
                  value={syncedFinanceId}
                  onChange={handleSyncChange}
                />
                <Field className="col-span-2">
                  <Label htmlFor="type">Account Type</Label>
                  <Select {...register('type')} id="type" name="type" disabled={isSynced}>
                    {categoryOrder.map((cat) => {
                      const types = typesByCategory[cat];
                      if (!types?.length) return null;
                      return (
                        <optgroup key={cat} label={TAX_CATEGORY_LABELS[cat]}>
                          {types.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </Select>
                  {errors.type && <ErrorMessage>{errors.type?.message}</ErrorMessage>}
                </Field>
                <Field className={getBalanceColSpan()}>
                  <Label htmlFor="balance">Balance</Label>
                  <NumberInput
                    name="balance"
                    control={control}
                    id="balance"
                    inputMode="decimal"
                    placeholder={formatCurrencyPlaceholder(15000)}
                    prefix={getCurrencySymbol()}
                    autoFocus={!isSynced}
                    readOnly={isSynced}
                  />
                  {errors.balance && <ErrorMessage>{errors.balance?.message}</ErrorMessage>}
                </Field>
                {showCostBasis && (
                  <Field>
                    <Label htmlFor="costBasis" className="flex w-full items-center justify-between">
                      <span className="whitespace-nowrap">Cost Basis</span>
                      <Tooltip>
                        <TooltipTrigger className="text-muted-foreground">
                          <InfoIcon className="size-4 fill-white dark:fill-stone-950" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>What you originally paid for your taxable investments.</p>
                          <p>Optional—helps calculate taxes owed when you sell.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <NumberInput
                      name="costBasis"
                      control={control}
                      id="costBasis"
                      inputMode="decimal"
                      placeholder="–"
                      prefix={getCurrencySymbol()}
                    />
                    {costBasisError && <ErrorMessage>{costBasisError.message}</ErrorMessage>}
                  </Field>
                )}
                {showContributionBasis && (
                  <Field>
                    <Label htmlFor="contributionBasis" className="flex w-full items-center justify-between">
                      <span className="whitespace-nowrap">Contribution Basis</span>
                      <Tooltip>
                        <TooltipTrigger className="text-muted-foreground">
                          <InfoIcon className="size-4 fill-white dark:fill-stone-950" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>The sum of your direct contributions (not earnings).</p>
                          <p>Optional—this portion can be withdrawn without penalty.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <NumberInput
                      name="contributionBasis"
                      control={control}
                      id="contributionBasis"
                      inputMode="decimal"
                      placeholder="–"
                      prefix={getCurrencySymbol()}
                    />
                    {contributionBasisError && <ErrorMessage>{contributionBasisError.message}</ErrorMessage>}
                  </Field>
                )}
                <Field className="col-span-2">
                  <Label htmlFor="percentBonds" className="flex w-full items-center justify-between">
                    <span className="whitespace-nowrap">% Bonds</span>
                    <Tooltip>
                      <TooltipTrigger className="text-muted-foreground">
                        <InfoIcon className="size-4 fill-white dark:fill-stone-950" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>The percentage of this account&apos;s holdings allocated to bonds.</p>
                        <p>Modeled as government bonds, which generate taxable interest income.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <NumberInput
                    name="percentBonds"
                    control={control}
                    id="percentBonds"
                    inputMode="decimal"
                    placeholder="20%"
                    suffix="%"
                    decimalScale={2}
                    step={1}
                    min={0}
                    max={100}
                  />
                  {percentBondsError && <ErrorMessage>{percentBondsError.message}</ErrorMessage>}
                </Field>
              </div>
            </FieldGroup>
          </DialogBody>
        </Fieldset>
        <DialogActions>
          <Button plain onClick={onClose} className="hidden sm:inline-flex" disabled={isSubmitting}>
            Cancel
          </Button>
          <Button color="rose" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </>
  );
}
