import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, RefreshCw, Database, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { QuebecManualUpload } from './QuebecManualUpload';

const API_URL = import.meta.env.VITE_API_URL || '';

export const QuebecRegistryManager = () => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [registryStatus, setRegistryStatus] = useState<'unknown' | 'available' | 'empty'>('unknown');
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [manualFlow, setManualFlow] = useState<any>(null);

  const checkRegistryStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/quebec/import-status`);
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      const data = await res.json();

      if (data.totalRecords && data.totalRecords > 0) {
        setRegistryStatus('available');
        setLastUpdate(data.lastImportDate ?? null);
      } else {
        setRegistryStatus('empty');
        setLastUpdate(null);
      }
    } catch (error) {
      console.error('Error checking registry status:', error);
      setRegistryStatus('unknown');
    }
  };

  const triggerDownload = async () => {
    setIsDownloading(true);
    
    try {
      toast({
        title: "Initiating Manual Download",
        description: "Getting download link and upload token...",
      });

      const res = await fetch(`${API_URL}/api/quebec/registry-download`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      const result = await res.json();

      console.log('Function result:', result);
      
      if (result?.success && result?.manual) {
        console.log('Setting manual flow:', result);
        setManualFlow(result);
        toast({
          title: "Manual Download Ready",
          description: "Please download the ZIP from the official link, then upload it below.",
        });
      } else {
        console.error('Unexpected result:', result);
        throw new Error(result?.error || 'Download setup failed');
      }
    } catch (error) {
      console.error('Download trigger error:', error);
      toast({
        title: "Download Setup Failed", 
        description: error instanceof Error ? error.message : "Failed to setup download",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Check status on component mount
  React.useEffect(() => {
    checkRegistryStatus();
  }, []);

  // Debug manual flow state
  React.useEffect(() => {
    console.log('Manual flow state changed:', manualFlow);
  }, [manualFlow]);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Quebec Business Registry Manager
        </CardTitle>
        <CardDescription>
          Manage Quebec business registry data downloads and processing
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            {registryStatus === 'available' ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : registryStatus === 'empty' ? (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            ) : (
              <RefreshCw className="h-5 w-5 text-gray-400" />
            )}
            <div>
              <p className="font-medium">
                Registry Status: {
                  registryStatus === 'available' ? 'Data Available' :
                  registryStatus === 'empty' ? 'No Data' :
                  'Checking...'
                }
              </p>
              {lastUpdate && (
                <p className="text-sm text-muted-foreground">
                  Last updated: {new Date(lastUpdate).toLocaleString()}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={checkRegistryStatus}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Status
          </Button>
        </div>

        <div className="space-y-4">
          <Button
            onClick={triggerDownload}
            disabled={isDownloading}
            className="w-full"
          >
            {isDownloading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Getting Ready...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Setup Manual Download
              </>
            )}
          </Button>
          
          {manualFlow ? (
            <div className="mt-4">
              <QuebecManualUpload 
                manualFlow={manualFlow} 
                onSuccess={() => {
                  setManualFlow(null);
                  checkRegistryStatus();
                }}
              />
            </div>
          ) : null}
          
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>How it works:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Click "Setup Manual Download" to get the official download link</li>
              <li>Open the link and download the ZIP file (wait for Cloudflare)</li>
              <li>Upload the ZIP here to import into the database</li>
              <li>Process typically takes 2-3 minutes</li>
            </ul>
            <p className="text-xs mt-3">
              <strong>Note:</strong> Manual process required due to Cloudflare protection on Quebec's site.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
