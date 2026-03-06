import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ExternalLink, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

interface QuebecManualUploadProps {
  manualFlow: {
    downloadUrl: string;
    fileName: string;
  };
  onSuccess?: () => void;
}

export const QuebecManualUpload = ({ manualFlow, onSuccess }: QuebecManualUploadProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processingRef = useRef(false);

  // Prevent accidental navigation while upload / parse is running
  useEffect(() => {
    if (isProcessing) {
      processingRef.current = true;
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (processingRef.current) {
          e.preventDefault();
          e.returnValue = 'Upload in progress. Are you sure you want to leave?';
          return e.returnValue;
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    } else {
      processingRef.current = false;
    }
  }, [isProcessing]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      console.log('File selected:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified).toISOString(),
      });
      if (file.size < 1024 * 10) {
        console.warn('Warning: Selected file is very small, might be a Cloudflare challenge page');
      }
    }
    setSelectedFile(file || null);
    setError(null);
    setUploadStatus(null);
    setParseStatus(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        title: 'No file selected',
        description: 'Please select a ZIP file to upload.',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    setError(null);
    setUploadStatus(null);
    setParseStatus(null);

    try {
      // Basic size check — anything under 1 MB is a Cloudflare HTML page, not the ZIP
      if (selectedFile.size < 1_048_576) {
        throw new Error(
          'File is too small — this is likely a Cloudflare challenge page, not the actual ZIP. Please re-download.',
        );
      }

      // Verify ZIP magic bytes (PK = 0x50 0x4B)
      const header = new Uint8Array(await selectedFile.slice(0, 4).arrayBuffer());
      if (!(header[0] === 0x50 && header[1] === 0x4b)) {
        throw new Error(
          'Selected file is not a valid ZIP. You likely downloaded a Cloudflare HTML page.',
        );
      }

      const mb = Math.round((selectedFile.size / 1024 / 1024) * 100) / 100;

      // -----------------------------------------------------------------------
      // Step 1 — Upload the ZIP to the Express server (disk storage).
      //
      // The server saves it to: uploads/quebec-registry/<fileName>
      // The 263 MB binary stays on the SERVER disk; the browser only streams
      // it once — no decompression or parsing happens in the browser.
      // -----------------------------------------------------------------------
      const fileName = manualFlow.fileName || selectedFile.name;
      setUploadStatus(`Uploading ${mb} MB to server...`);

      const uploadRes = await fetch(
        `${API_URL}/api/quebec/upload?fileName=${encodeURIComponent(fileName)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: selectedFile, // browser streams the file body directly - no extra RAM copy
        },
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `Upload error ${uploadRes.status}`);
      }

      const uploadData = await uploadRes.json();
      console.log('Upload complete:', uploadData);
      setUploadStatus(`File uploaded (${mb} MB)`);

      // -----------------------------------------------------------------------
      // Step 2 — Ask the Express server to decompress, parse and import.
      //
      // All RAM-heavy work (unzip + CSV parse + ~500k DB inserts) happens
      // server-side. The browser just waits for a JSON result.
      // -----------------------------------------------------------------------
      setParseStatus('Server is processing the ZIP... (this may take a few minutes)');

      const parseRes = await fetch(`${API_URL}/api/quebec/parse-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName }),
      });

      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({ error: 'Parse failed' }));
        throw new Error(err.error || `Parse error ${parseRes.status}`);
      }

      const parseData = await parseRes.json();
      const { inserted = 0, skipped = 0 } = parseData.summary ?? {};
      setParseStatus(
        `Done - ${inserted.toLocaleString()} companies imported${skipped > 0 ? `, ${skipped} skipped` : ''}`,
      );

      console.log('Import complete:', parseData);

      toast({
        title: 'Import successful',
        description: `${inserted.toLocaleString()} companies imported from the Quebec registry.`,
        duration: 6000,
      });

      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Upload error:', err);
      setError(msg);
      toast({
        title: 'Upload failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(manualFlow.downloadUrl, '_blank')}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open Official Download Page
            </Button>
            <span className="text-xs text-muted-foreground">
              ← Download the ZIP after the page loads
            </span>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Upload Downloaded ZIP File:</label>
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              disabled={isProcessing}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Selected: {selectedFile.name} (
                {Math.round((selectedFile.size / 1024 / 1024) * 100) / 100} MB)
              </p>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isProcessing}
            className="w-full"
            size="sm"
          >
            {isProcessing ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-pulse" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload & Import
              </>
            )}
          </Button>
        </div>

        {uploadStatus && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <CheckCircle2 className="h-4 w-4" />
            {uploadStatus}
          </div>
        )}

        {parseStatus && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            {parseStatus}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="text-xs text-muted-foreground bg-gray-50 p-2 rounded">
          <strong>Tip:</strong> If your downloaded file is only 3-4 KB, it is a Cloudflare
          challenge page. Wait for the page to fully load, then click the download button again.
        </div>
      </CardContent>
    </Card>
  );
};
