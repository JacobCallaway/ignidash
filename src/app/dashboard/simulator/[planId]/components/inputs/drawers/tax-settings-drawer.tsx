'use client';

import { ConvexError } from 'convex/values';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useEffect, useMemo, useState } from 'react';
import posthog from 'posthog-js';
import { z } from 'zod';

import { taxSettingsToConvex } from '@/lib/utils/data-transformers';
import { type TaxSettingsInputs } from '@/lib/schemas/inputs/tax-settings-form-schema';
import SectionHeader from '@/components/ui/section-header';
import SectionContainer from '@/components/ui/section-container';
import Card from '@/components/ui/card';
import { Field, FieldGroup, Fieldset, Label, Description, ErrorMessage } from '@/components/catalyst/fieldset';
import ErrorMessageCard from '@/components/ui/error-message-card';
import { Select } from '@/components/catalyst/select';
import { Divider } from '@/components/catalyst/divider';
import { Button } from '@/components/catalyst/button';
import { DialogActions } from '@/components/catalyst/dialog';
import { useSelectedPlanId } from '@/hooks/use-selected-plan-id';
import type { CountryConfig } from '@/lib/country/types';
import { AVAILABLE_COUNTRIES, getCountryConfig } from '@/lib/country';

interface TaxSettingsDrawerProps {
  setOpen: (open: boolean) => void;
  taxSettings: TaxSettingsInputs | null;
  countryConfig: CountryConfig;
}

const drawerSchema = z.object({ country: z.string(), filingStatus: z.string() });
type DrawerValues = z.infer<typeof drawerSchema>;

export default function TaxSettingsDrawer({ setOpen, taxSettings, countryConfig }: TaxSettingsDrawerProps) {
  const planId = useSelectedPlanId();

  const defaultValues: DrawerValues = useMemo(
    () => ({
      country: countryConfig.code,
      filingStatus: taxSettings?.filingStatus ?? countryConfig.filingStatuses[0]?.id ?? 'single',
    }),
    [countryConfig, taxSettings]
  );

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DrawerValues>({
    resolver: zodResolver(drawerSchema),
    defaultValues,
  });

  const selectedCountry = useWatch({ control, name: 'country' });
  const selectedCountryConfig = useMemo(() => getCountryConfig(selectedCountry), [selectedCountry]);

  useEffect(() => {
    setValue('filingStatus', selectedCountryConfig.filingStatuses[0]?.id ?? 'single');
  }, [selectedCountry, selectedCountryConfig, setValue]);

  useEffect(() => {
    reset(defaultValues);
  }, [taxSettings, countryConfig, reset, defaultValues]);

  const updateCountryMutation = useMutation(api.plans.updateCountry);
  const updateTaxSettingsMutation = useMutation(api.tax_settings.update);
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSubmit = async (data: DrawerValues) => {
    try {
      setSaveError(null);
      posthog.capture('save_tax_settings', { plan_id: planId });
      if (data.country !== countryConfig.code) {
        await updateCountryMutation({ planId, country: data.country, filingStatus: data.filingStatus });
      } else {
        await updateTaxSettingsMutation({ taxSettings: taxSettingsToConvex({ filingStatus: data.filingStatus }), planId });
      }
      setOpen(false);
    } catch (error) {
      setSaveError(error instanceof ConvexError ? error.message : 'Failed to save settings.');
      console.error('Error saving tax settings: ', error);
    }
  };

  return (
    <>
      <SectionContainer showBottomBorder={false} location="drawer">
        <SectionHeader title="Tax Settings" desc="Manage settings that affect your tax calculations." />
        <Card>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Fieldset aria-label="Tax settings details">
              <FieldGroup>
                {saveError && <ErrorMessageCard errorMessage={saveError} />}
                <Field>
                  <Label htmlFor="country">Country</Label>
                  <Select {...register('country')} id="country" name="country">
                    {AVAILABLE_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Description>Changing the country resets your filing status and updates account types and tax rules.</Description>
                </Field>
                <Field>
                  <Label htmlFor="filingStatus">Filing Status</Label>
                  <Select {...register('filingStatus')} id="filingStatus" name="filingStatus">
                    {selectedCountryConfig.filingStatuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  {errors.filingStatus && <ErrorMessage>{errors.filingStatus?.message}</ErrorMessage>}
                  <Description>Your filing status determines your tax rates and standard deduction.</Description>
                </Field>
                <Divider />
              </FieldGroup>
            </Fieldset>
            <DialogActions>
              <Button outline onClick={() => reset()}>
                Reset
              </Button>
              <Button color="rose" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </DialogActions>
          </form>
        </Card>
      </SectionContainer>
    </>
  );
}
