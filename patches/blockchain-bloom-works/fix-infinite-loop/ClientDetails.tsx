import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useClientDetails } from '@/hooks/client/useClientDetails'; // Updated import path
import ClientDetailsLoader from '@/components/client/ClientDetailsLoader';
import ClientDetailsError from '@/components/client/ClientDetailsError';
import ClientDetailsContent from '@/components/client/details/ClientDetailsContent';
import { useWallet } from '@/contexts/WalletContext';
import { useToast } from '@/hooks/use-toast';
import { useDirectAmlData } from '@/hooks/client/useDirectAmlData';

export default function ClientDetails() {
  const { companyName, registrationNumber } = useParams<{ companyName: string; registrationNumber: string }>();
  const navigate = useNavigate();
  const { wallet } = useWallet();
  const { toast } = useToast();
  
  const { 
    activeTab,
    setActiveTab,
    loading,
    companyData,
    country,
    complianceItems,
    uploadDialogOpen,
    setUploadDialogOpen,
    selectedFiles,
    setSelectedFiles,
    uploadProgress,
    selectedDocumentTypes,
    deletingFile,
    handleUpdateCountry,
    updateKycVerification,
    isVerificationValid,
    kycVerificationData,
    amlCheckData,
    handleDownload,
    handleUpload,
    handleRemoveFile,
    handleDocumentTypeChange,
    handleDeleteStoredFile,
    handlePurgeAllFiles,
    handleRegister,
    forceRefresh
  } = useClientDetails(companyName, registrationNumber);

  // Use the extracted hook to fetch AML data directly
  const directAmlData = useDirectAmlData(companyData);

  // Redirect if no company name or registration number
  useEffect(() => {
    if (!companyName || !registrationNumber) {
      navigate('/client');
    }
  }, [companyName, registrationNumber, navigate]);

// Set country from company data if needed.
// handleUpdateCountry is stable (wrapped in useCallback in useCompanyCountry) so it is
// safe to include in the dependency array.  The condition `!country` prevents repeated
// calls once the country has been set.
React.useEffect(() => {
  if (companyData?.Country && !country) {
    console.log("Setting country from company data:", companyData.Country);
    handleUpdateCountry(companyData.Country);
  }
}, [companyData, country, handleUpdateCountry]);

  // Debug logs
  React.useEffect(() => {
    if (companyData) {
      console.log("Company data:", companyData);
      console.log("Country:", country);
      console.log("Is KYC verified:", isVerificationValid());
      console.log("KYC verification data:", kycVerificationData);
      console.log("AML check data (from hook):", amlCheckData);
      console.log("Direct AML check data:", directAmlData);
      console.log("Final AML data to be used:", amlCheckData || directAmlData);
    }
  }, [companyData, country, isVerificationValid, kycVerificationData, amlCheckData, directAmlData]);

  const handleVerificationSuccess = () => {
    console.log("Verification success callback triggered");
    updateKycVerification("verified");
    toast({
      title: "Verification Successful",
      description: "Company has been successfully verified",
      variant: "default",
    });
  };

  if (loading) {
    return <ClientDetailsLoader />;
  }

  if (!companyData) {
    return <ClientDetailsError />;
  }

  const finalAmlData = amlCheckData || directAmlData;

  return (
    <ClientDetailsContent
      companyName={companyName}
      isWalletConnected={wallet?.isConnected || false}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      companyData={companyData}
      country={country}
      complianceItems={complianceItems}
      uploadDialogOpen={uploadDialogOpen}
      setUploadDialogOpen={setUploadDialogOpen}
      selectedFiles={selectedFiles}
      setSelectedFiles={setSelectedFiles}
      uploadProgress={uploadProgress}
      selectedDocumentTypes={selectedDocumentTypes}
      deletingFile={deletingFile}
      handleUpdateCountry={handleUpdateCountry}
      updateKycVerification={updateKycVerification}
      isVerificationValid={isVerificationValid}
      amlCheckData={finalAmlData}
      handleDownload={handleDownload}
      handleUpload={handleUpload}
      handleRemoveFile={handleRemoveFile}
      handleDocumentTypeChange={handleDocumentTypeChange}
      handleDeleteStoredFile={handleDeleteStoredFile}
      handlePurgeAllFiles={handlePurgeAllFiles}
      handleRegister={handleRegister}
      forceRefresh={forceRefresh}
      handleVerificationSuccess={handleVerificationSuccess}
    />
  );
};
