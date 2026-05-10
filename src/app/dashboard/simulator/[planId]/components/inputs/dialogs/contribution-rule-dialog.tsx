'use client';

import { ConvexError } from 'convex/values';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useEffect, useMemo, useState } from 'react';
import { HandCoinsIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import posthog from 'posthog-js';

import { useAccountsData, useDebtsData, useIncomesData, useTimelineData } from '@/hooks/use-convex-data';
import { contributionToConvex } from '@/lib/utils/data-transformers';
import { DialogTitle, DialogDescription, DialogBody, DialogActions } from '@/components/catalyst/dialog';
import { contributionFormSchema, type ContributionInputs, buildContributionHelpers } from '@/lib/schemas/inputs/contribution-form-schema';
import { useCountryConfig } from '@/hooks/use-country-config';
import { accountTypeForDisplay } from '@/lib/schemas/inputs/account-form-schema';
import { calculateAge } from '@/lib/schemas/inputs/timeline-form-schema';
import NumberInput from '@/components/ui/number-input';
import { Fieldset, FieldGroup, Field, Label, ErrorMessage, Description } from '@/components/catalyst/fieldset';
import { Switch, SwitchField } from '@/components/catalyst/switch';
import ErrorMessageCard from '@/components/ui/error-message-card';
import { Select } from '@/components/catalyst/select';
import { Button } from '@/components/catalyst/button';
import { formatCompactCurrency, getCurrencySymbol, formatCurrencyPlaceholder } from '@/lib/utils/number-formatters';
import { useSelectedPlanId } from '@/hooks/use-selected-plan-id';
import { getErrorMessages } from '@/lib/utils/form-utils';
import { Divider } from '@/components/catalyst/divider';

interface ContributionRuleDialogProps {
  onClose: () => void;
  selectedContributionRule: ContributionInputs | null;
  numContributionRules: number;
}

export default function ContributionRuleDialog({
  onClose,
  selectedContributionRule: _selectedContributionRule,
  numContributionRules,
}: ContributionRuleDialogProps) {
  const planId = useSelectedPlanId();
  const [selectedContributionRule] = useState(_selectedContributionRule);
  const countryConfig = useCountryConfig();
  const {
    supportsMaxBalance,
    supportsIncomeAllocation,
    supportsEmployerMatch,
    supportsMegaBackdoorRoth,
    getAnnualContributionLimit,
    getAnnualSection415cLimit,
  } = useMemo(() => buildContributionHelpers(countryConfig), [countryConfig]);

  const defaultRank = numContributionRules + 1;
  const newContributionRuleDefaultValues = useMemo(
    () =>
      ({
        id: '',
        rank: defaultRank,
        contributionType: 'unlimited' as ContributionInputs['contributionType'],
      }) as const satisfies Partial<ContributionInputs>,
    [defaultRank]
  );

  const defaultValues = (selectedContributionRule || newContributionRuleDefaultValues) as never;

  const {
    register,
    unregister,
    control,
    handleSubmit,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(contributionFormSchema),
    defaultValues,
  });

  const hasFormErrors = Object.keys(errors).length > 0;

  const m = useMutation(api.contribution_rule.upsertContributionRule);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSubmit = async (data: ContributionInputs) => {
    const contributionRuleId = data.id === '' ? uuidv4() : data.id;
    try {
      setSaveError(null);
      posthog.capture('save_contribution_rule', { plan_id: planId, save_mode: selectedContributionRule ? 'edit' : 'create' });
      await m({ contributionRule: contributionToConvex({ ...data, id: contributionRuleId }), planId });
      onClose();
    } catch (error) {
      setSaveError(error instanceof ConvexError ? error.message : 'Failed to save contribution rule.');
      console.error('Error saving contribution rule: ', error);
    }
  };

  const contributionType = useWatch({ control, name: 'contributionType' });
  const accountId = useWatch({ control, name: 'accountId' });
  const watchedDebtId = useWatch({ control, name: 'debtId' });
  const enableMegaBackdoorRoth = useWatch({ control, name: 'enableMegaBackdoorRoth' });
  // 'percent' mode when employerMatchPercent is set (even if 0); 'fixed' otherwise
  const [employerMatchMode, setEmployerMatchMode] = useState<'fixed' | 'percent'>(
    selectedContributionRule?.employerMatchPercent !== undefined ? 'percent' : 'fixed'
  );
  // target type: 'account' when accountId is set on existing rule, 'debt' when debtId is set
  const [targetType, setTargetType] = useState<'account' | 'debt'>(selectedContributionRule?.debtId ? 'debt' : 'account');

  const getContributionTypeColSpan = () => {
    if (contributionType === 'dollarAmount' || contributionType === 'percentRemaining' || contributionType === 'percentOfIncome')
      return 'col-span-1';
    return 'col-span-2';
  };

  const { data: accounts } = useAccountsData();
  const accountOptions = Object.entries(accounts).map(([id, account]) => ({ id, name: account.name, type: account.type }));
  const selectedAccount = accountId ? accounts[accountId] : null;

  const { data: debts } = useDebtsData();
  const debtOptions = Object.entries(debts).map(([id, debt]) => ({ id, name: debt.name }));

  const timeline = useTimelineData();
  const currentAge = timeline ? calculateAge(timeline.birthMonth, timeline.birthYear) : 18;
  const selectedAccountAnnualContributionLimit = selectedAccount
    ? enableMegaBackdoorRoth
      ? getAnnualSection415cLimit(selectedAccount.type, currentAge)
      : getAnnualContributionLimit(selectedAccount.type, currentAge)
    : null;

  const { data: incomes } = useIncomesData();
  const incomeOptions = Object.entries(incomes).map(([id, income]) => ({ id, name: income.name }));

  useEffect(() => {
    if (!(contributionType === 'dollarAmount')) {
      unregister('dollarAmount');
    }

    if (!(contributionType === 'percentRemaining')) {
      unregister('percentRemaining');
    }

    if (!(contributionType === 'percentOfIncome')) {
      unregister('percentOfIncome');
    }

    if (targetType === 'debt') {
      unregister('accountId');
      unregister('maxBalance');
      unregister('incomeId');
      unregister('employerMatch');
      unregister('employerMatchPercent');
      unregister('enableMegaBackdoorRoth');
      return;
    }

    unregister('debtId');

    if (!(selectedAccount && supportsMaxBalance(selectedAccount.type))) {
      unregister('maxBalance');
    }

    if (!(selectedAccount && supportsIncomeAllocation(selectedAccount.type))) {
      unregister('incomeId');
    }

    if (!(selectedAccount && supportsEmployerMatch(selectedAccount.type))) {
      unregister('employerMatch');
      unregister('employerMatchPercent');
    } else if (employerMatchMode === 'percent') {
      unregister('employerMatch');
    } else {
      unregister('employerMatchPercent');
    }

    if (!(selectedAccount && supportsMegaBackdoorRoth(selectedAccount.type))) {
      unregister('enableMegaBackdoorRoth');
    }
  }, [contributionType, unregister, selectedAccount, employerMatchMode, targetType]);

  const { error: dollarAmountError } = getFieldState('dollarAmount');
  const { error: percentRemainingError } = getFieldState('percentRemaining');
  const { error: percentOfIncomeError } = getFieldState('percentOfIncome');

  return (
    <>
      <DialogTitle onClose={onClose}>
        <div className="flex items-center gap-4">
          <HandCoinsIcon className="text-primary size-8 shrink-0" aria-hidden="true" />
          <span>{selectedContributionRule ? 'Edit Contribution Rule' : 'New Contribution Rule'}</span>
        </div>
      </DialogTitle>
      <DialogDescription className="hidden sm:block">
        Rules to control how any excess cash is contributed to your accounts during the simulation.
      </DialogDescription>
      <form onSubmit={handleSubmit(onSubmit)}>
        <Fieldset aria-label="Contribution rule details">
          <DialogBody className="sm:mt-4">
            <FieldGroup>
              {(saveError || hasFormErrors) && <ErrorMessageCard errorMessage={saveError || getErrorMessages(errors).join(', ')} />}
              <Divider soft className="hidden sm:block" />
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field>
                  <Label htmlFor="targetType">Target</Label>
                  <Select id="targetType" value={targetType} onChange={(e) => setTargetType(e.target.value as 'account' | 'debt')}>
                    <option value="account">Account</option>
                    <option value="debt">Debt</option>
                  </Select>
                </Field>
                {targetType === 'account' && (
                  <Field>
                    <Label htmlFor="accountId">Account</Label>
                    <Select {...register('accountId')} id="accountId" name="accountId" defaultValue="" invalid={!!errors.accountId}>
                      <option value="" disabled>
                        Select&hellip;
                      </option>
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} | {accountTypeForDisplay(account.type)}
                        </option>
                      ))}
                    </Select>
                    {errors.accountId && <ErrorMessage>{errors.accountId?.message}</ErrorMessage>}
                  </Field>
                )}
                {targetType === 'debt' && (
                  <Field>
                    <Label htmlFor="debtId">Debt</Label>
                    <Select {...register('debtId')} id="debtId" name="debtId" defaultValue="" invalid={!!errors.debtId}>
                      <option value="" disabled>
                        Select&hellip;
                      </option>
                      {debtOptions.map((debt) => (
                        <option key={debt.id} value={debt.id}>
                          {debt.name}
                        </option>
                      ))}
                    </Select>
                    {errors.debtId && <ErrorMessage>{errors.debtId?.message}</ErrorMessage>}
                  </Field>
                )}
              </div>
              {targetType === 'account' &&
                selectedAccountAnnualContributionLimit !== null &&
                Number.isFinite(selectedAccountAnnualContributionLimit) && (
                  <Description>
                    You can contribute up to <strong>{formatCompactCurrency(selectedAccountAnnualContributionLimit, 0)}</strong> per year.
                  </Description>
                )}
              {targetType === 'debt' && watchedDebtId && (
                <Description>Extra payments are capped at the remaining debt balance each month.</Description>
              )}
              {targetType === 'account' && selectedAccount && supportsIncomeAllocation(selectedAccount.type) && (
                <>
                  <Field>
                    <Label htmlFor="incomeId">From Income</Label>
                    <Select {...register('incomeId')} id="incomeId" name="incomeId" invalid={!!errors.incomeId}>
                      <option value="">Any income</option>
                      {incomeOptions.map((income) => (
                        <option key={income.id} value={income.id}>
                          {income.name}
                        </option>
                      ))}
                    </Select>
                    {errors.incomeId && <ErrorMessage>{errors.incomeId?.message}</ErrorMessage>}
                    <Description>Allow contributions only from a specific income source, if applicable.</Description>
                  </Field>
                  <Divider soft />
                </>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Field className={getContributionTypeColSpan()}>
                  <Label htmlFor="contributionType">Type</Label>
                  <Select
                    {...register('contributionType')}
                    id="contributionType"
                    name="contributionType"
                    invalid={!!errors.contributionType}
                  >
                    <option value="dollarAmount">Fixed Amount</option>
                    <option value="percentOfIncome">% of Income</option>
                    <option value="percentRemaining">% Remaining</option>
                    <option value="unlimited">Unlimited</option>
                  </Select>
                  {errors.contributionType && <ErrorMessage>{errors.contributionType?.message}</ErrorMessage>}
                </Field>
                {contributionType === 'dollarAmount' && (
                  <Field>
                    <Label htmlFor="dollarAmount">Dollar Amount</Label>
                    <NumberInput
                      name="dollarAmount"
                      control={control}
                      id="dollarAmount"
                      inputMode="decimal"
                      placeholder={formatCurrencyPlaceholder(2500)}
                      prefix={getCurrencySymbol()}
                      autoFocus={selectedContributionRule !== null}
                    />
                    {dollarAmountError && <ErrorMessage>{dollarAmountError.message}</ErrorMessage>}
                  </Field>
                )}
                {contributionType === 'percentOfIncome' && (
                  <Field>
                    <Label htmlFor="percentOfIncome">% of Income</Label>
                    <NumberInput
                      name="percentOfIncome"
                      control={control}
                      id="percentOfIncome"
                      inputMode="decimal"
                      placeholder="5%"
                      suffix="%"
                      autoFocus={selectedContributionRule !== null}
                    />
                    {percentOfIncomeError && <ErrorMessage>{percentOfIncomeError.message}</ErrorMessage>}
                  </Field>
                )}
                {contributionType === 'percentRemaining' && (
                  <Field>
                    <Label htmlFor="percentRemaining">% Remaining</Label>
                    <NumberInput
                      name="percentRemaining"
                      control={control}
                      id="percentRemaining"
                      inputMode="decimal"
                      placeholder="25%"
                      suffix="%"
                      autoFocus={selectedContributionRule !== null}
                    />
                    {percentRemainingError && <ErrorMessage>{percentRemainingError.message}</ErrorMessage>}
                  </Field>
                )}
              </div>
              {targetType === 'account' && selectedAccount && supportsMaxBalance(selectedAccount.type) && (
                <Field>
                  <Label htmlFor="maxBalance" className="flex w-full items-center justify-between">
                    <span className="whitespace-nowrap">Maximum Balance</span>
                    <span className="text-muted-foreground hidden truncate text-sm/6 sm:inline">Optional</span>
                  </Label>
                  <NumberInput
                    name="maxBalance"
                    control={control}
                    id="maxBalance"
                    inputMode="decimal"
                    placeholder={formatCurrencyPlaceholder(15000)}
                    prefix={getCurrencySymbol()}
                  />
                  {errors.maxBalance && <ErrorMessage>{errors.maxBalance?.message}</ErrorMessage>}
                  <Description>Stop contributing to this account once it reaches this balance.</Description>
                </Field>
              )}
              {targetType === 'account' && selectedAccount && supportsEmployerMatch(selectedAccount.type) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <Field>
                    <Label htmlFor="employerMatchMode" className="flex w-full items-center justify-between">
                      <span className="whitespace-nowrap">Employer Match</span>
                      <span className="text-muted-foreground hidden truncate text-sm/6 sm:inline">Optional</span>
                    </Label>
                    <Select
                      id="employerMatchMode"
                      value={employerMatchMode}
                      onChange={(e) => setEmployerMatchMode(e.target.value as 'fixed' | 'percent')}
                    >
                      <option value="fixed">Fixed Amount</option>
                      <option value="percent">% of Income</option>
                    </Select>
                  </Field>
                  {employerMatchMode === 'fixed' && (
                    <Field>
                      <Label htmlFor="employerMatch">&nbsp;</Label>
                      <NumberInput
                        name="employerMatch"
                        control={control}
                        id="employerMatch"
                        inputMode="decimal"
                        placeholder={formatCurrencyPlaceholder(7000)}
                        prefix={getCurrencySymbol()}
                      />
                      {errors.employerMatch && <ErrorMessage>{errors.employerMatch?.message}</ErrorMessage>}
                    </Field>
                  )}
                  {employerMatchMode === 'percent' && (
                    <Field>
                      <Label htmlFor="employerMatchPercent">&nbsp;</Label>
                      <NumberInput
                        name="employerMatchPercent"
                        control={control}
                        id="employerMatchPercent"
                        inputMode="decimal"
                        placeholder="3%"
                        suffix="%"
                      />
                      {errors.employerMatchPercent && <ErrorMessage>{errors.employerMatchPercent?.message}</ErrorMessage>}
                    </Field>
                  )}
                  <Description className="col-span-2">
                    {employerMatchMode === 'percent'
                      ? 'Employer contributes this percentage of the linked income each year, independent of your contribution.'
                      : 'Employer will match your contributions dollar-for-dollar up to this annual amount.'}
                  </Description>
                </div>
              )}
              {targetType === 'account' && selectedAccount && supportsMegaBackdoorRoth(selectedAccount.type) && (
                <>
                  <Divider soft />
                  <SwitchField>
                    <Label>Enable mega-backdoor Roth</Label>
                    <Description>Contribute up to the 415(c) limit using after-tax conversions.</Description>
                    <Controller
                      name="enableMegaBackdoorRoth"
                      defaultValue={false}
                      control={control}
                      render={({ field: { onChange, value, name } }) => <Switch name={name} checked={value} onChange={onChange} />}
                    />
                  </SwitchField>
                </>
              )}
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
