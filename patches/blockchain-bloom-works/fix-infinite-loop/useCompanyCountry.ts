import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export const useCompanyCountry = (companyName: string | undefined, registrationNumber: string | undefined, initialCountry: string | null) => {
  const [country, setCountry] = useState<string | null>(initialCountry);

  // Update country when initialCountry changes (e.g., when company data loads)
  useEffect(() => {
    setCountry(initialCountry);
  }, [initialCountry]);

  const handleUpdateCountry = useCallback(async (newCountry: string) => {
    console.log(`Updating country for ${companyName} (${registrationNumber}) to ${newCountry}`);
    if (!companyName || !registrationNumber) return;

    try {
      // Try direct DB update first (works for admins and owners via RLS)
      const { data: { user } } = await supabase.auth.getUser();

      let updated = false;

      if (user) {
        const { data: updatedRows, error: directError } = await supabase
          .from('company')
          .update({ Country: newCountry })
          .eq('Name', companyName)
          .eq('Registration number', registrationNumber)
          .select();

        if (!directError && Array.isArray(updatedRows) && updatedRows.length > 0) {
          updated = true;
        }
      }

      if (!updated) {
        // Legacy client access - use the legacy update function with stored credentials
        console.log('Falling back to legacy function for country update...');
        const clientLogin = sessionStorage.getItem('clientLogin');
        const clientPassword = sessionStorage.getItem('clientPassword');
        
        if (!clientLogin || !clientPassword) {
          throw new Error('Could not update company country: missing legacy credentials and insufficient permissions.');
        }

        const { data, error: rpcError } = await supabase.rpc('update_company_country_legacy', {
          p_company_name: companyName,
          p_registration_number: registrationNumber,
          p_login: clientLogin,
          p_password: clientPassword,
          p_new_country: newCountry
        });

        if (rpcError || !data) {
          throw new Error('Legacy update failed: invalid credentials or access denied');
        }
      }


      // Update local state
      setCountry(newCountry);

      toast({
        title: "Country Updated",
        description: `Company location set to ${newCountry}`,
      });

      return Promise.resolve();
    } catch (error) {
      console.error('Error updating company country:', error);
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "Could not update company country",
        variant: "destructive",
      });
      return Promise.reject(error);
    }
  }, [companyName, registrationNumber]);

  return {
    country,
    setCountry,
    handleUpdateCountry,
  };
};
