import { useCallback } from 'react';

export const useComplianceValidation = () => {
  const isVerificationValid = useCallback((lastChecked: string): boolean => {
    if (!lastChecked) return false;
    
    try {
      const checkDate = new Date(lastChecked);
      
      // Check if the date is valid
      if (isNaN(checkDate.getTime())) {
        console.error("Invalid date format for compliance validation:", lastChecked);
        return false;
      }
      
      // Calculate the cutoff date (14 days ago)
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      
      // Reset time components to compare dates only
      const checkDateOnly = new Date(checkDate);
      checkDateOnly.setHours(0, 0, 0, 0);
      
      const twoWeeksAgoOnly = new Date(twoWeeksAgo);
      twoWeeksAgoOnly.setHours(0, 0, 0, 0);
      
      // Enhanced logging for date comparison
      console.log("Compliance validation detailed comparison:", {
        originalLastChecked: lastChecked,
        parsedCheckDate: checkDate.toISOString(),
        checkDateOnly: checkDateOnly.toISOString(),
        twoWeeksAgo: twoWeeksAgo.toISOString(),
        twoWeeksAgoOnly: twoWeeksAgoOnly.toISOString(),
        isValid: checkDateOnly >= twoWeeksAgoOnly
      });
      
      // The verification is valid if the check date is more recent than or equal to the cutoff
      return checkDateOnly >= twoWeeksAgoOnly;
    } catch (error) {
      console.error("Error in compliance validation:", error);
      return false;
    }
  }, []);

  return {
    isVerificationValid
  };
};
