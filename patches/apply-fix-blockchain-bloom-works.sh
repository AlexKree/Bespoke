#!/usr/bin/env bash
# =============================================================================
# Fix: Quebec registry download - supabase is not defined
# Run from the root of the blockchain-bloom-works repository
# =============================================================================
set -euo pipefail

# Verify python3 is available (used for patching client.ts)
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 is required but was not found. Please install Python 3 and retry."
  exit 1
fi

# Ensure we are inside the correct git repository
if ! git rev-parse --show-toplevel &>/dev/null; then
  echo "ERROR: Not inside a git repository. Run this script from the root of blockchain-bloom-works."
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Guard: must look like blockchain-bloom-works
if [ ! -f "$REPO_ROOT/src/integrations/supabase/client.ts" ]; then
  echo "ERROR: src/integrations/supabase/client.ts not found."
  echo "       This script must be run from the blockchain-bloom-works repository root."
  exit 1
fi

echo "Applying Quebec registry download fix to: $REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Add missing import to QuebecTestDownload.tsx
# ---------------------------------------------------------------------------
FILE="src/components/admin/QuebecTestDownload.tsx"
if [ ! -f "$FILE" ]; then
  echo "[WARN] $FILE not found – skipping"
elif grep -q "from '@/integrations/supabase/client'" "$FILE"; then
  echo "[SKIP] $FILE already has the supabase import"
else
  # Insert the import after the lucide-react import line (last import before the component)
  python3 - "$FILE" << 'PYEOF'
import sys, re, os
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()
new_import = "import { supabase } from '@/integrations/supabase/client';"
if new_import in content:
    print(f"[SKIP] {path} already has the import")
    sys.exit(0)
# Insert after the lucide-react import line
pattern = r"(import \{ Download, AlertCircle, X \} from 'lucide-react';)"
replacement = r"\1\n" + new_import
result, n = re.subn(pattern, replacement, content, count=1)
if n == 0:
    print(f"[WARN] Could not locate lucide-react import in {path} – trying fallback")
    # Fallback: insert after the last 'import' line that starts the file
    lines = content.split('\n')
    last_import = max((i for i, l in enumerate(lines) if l.startswith('import ')), default=-1)
    if last_import >= 0:
        lines.insert(last_import + 1, new_import)
        result = '\n'.join(lines)
    else:
        print(f"[ERROR] Could not insert import into {path}")
        sys.exit(1)
with open(path, 'w') as f:
    f.write(result)
print(f"[OK]   Added supabase import to {path}")
PYEOF
fi

# ---------------------------------------------------------------------------
# 2. Add missing import to processQuebecRegistry.ts
# ---------------------------------------------------------------------------
FILE="src/utils/processQuebecRegistry.ts"
if [ ! -f "$FILE" ]; then
  echo "[WARN] $FILE not found – skipping"
elif grep -q "from '@/integrations/supabase/client'" "$FILE"; then
  echo "[SKIP] $FILE already has the supabase import"
else
  python3 - "$FILE" << 'PYEOF'
import sys
path = sys.argv[1]
new_import = "import { supabase } from '@/integrations/supabase/client';\n"
with open(path, 'r') as f:
    content = f.read()
if new_import.strip() in content:
    print(f"[SKIP] {path} already has the import")
    sys.exit(0)
with open(path, 'w') as f:
    f.write(new_import + content)
print(f"[OK]   Added supabase import to {path}")
PYEOF
fi

# ---------------------------------------------------------------------------
# 3. Patch ApiClient in src/integrations/supabase/client.ts
#    - Add uploadToSignedUrl to storage.from()
#    - Add functions.invoke()
# ---------------------------------------------------------------------------
FILE="src/integrations/supabase/client.ts"
if [ ! -f "$FILE" ]; then
  echo "[WARN] $FILE not found – skipping"
elif grep -q "uploadToSignedUrl" "$FILE"; then
  echo "[SKIP] $FILE already has uploadToSignedUrl"
else
  python3 - "$FILE" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

old = """        getPublicUrl: (path: string) => {
          return { data: { publicUrl: `/storage/${path}` } };
        }
      };
    }
  };"""

new = """        getPublicUrl: (path: string) => {
          return { data: { publicUrl: `/storage/${path}` } };
        },
        // Replaces supabase.storage.from(bucket).uploadToSignedUrl(path, token, file).
        // The signed-URL token is no longer used; the file is sent straight to the
        // Express /api/quebec/upload endpoint as a raw binary body.
        uploadToSignedUrl: async (_path: string, _token: string, file: File) => {
          const encodedName = encodeURIComponent(file.name || _path);
          const url = `${API_URL}/api/quebec/upload?fileName=${encodedName}`;
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: file,
            });
            const data = await response.json();
            if (!response.ok) {
              return { data: null, error: new Error(data.error || 'Upload failed') };
            }
            return { data, error: null };
          } catch (error: any) {
            console.error('Storage uploadToSignedUrl failed:', error);
            return { data: null, error };
          }
        },
      };
    }
  };

  // Edge-function invocations – maps former Supabase Function names to Express API routes.
  // Add a new entry here for every function that was previously called via
  // supabase.functions.invoke().
  functions = {
    invoke: async (functionName: string, options?: { body?: any }) => {
      const functionEndpoints: Record<string, { method: string; endpoint: string }> = {
        'quebec-registry-download': { method: 'POST', endpoint: '/api/quebec/registry-download' },
        'quebec-csv-parser':        { method: 'POST', endpoint: '/api/quebec/parse-csv' },
      };

      const mapping = functionEndpoints[functionName];
      if (!mapping) {
        console.error(`functions.invoke: no mapping for "${functionName}"`);
        return {
          data: null,
          error: new Error(`Function "${functionName}" is not mapped to an API endpoint`),
        };
      }

      return this.request(mapping.endpoint, {
        method: mapping.method,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
    },
  };"""

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w') as f:
        f.write(content)
    print(f"[OK]   Patched {path}")
else:
    print(f"[ERROR] Could not find expected pattern in {path}")
    print(f"        The file may have been modified. Please apply the changes manually.")
    sys.exit(1)
PYEOF
fi

# ---------------------------------------------------------------------------
# 4. Create server/routes/quebec.ts
# ---------------------------------------------------------------------------
DEST="server/routes/quebec.ts"
if [ -f "$DEST" ]; then
  echo "[SKIP] $DEST already exists"
else
  mkdir -p server/routes
  cat > "$DEST" << 'TSEOF'
import express, { Request, Response } from 'express';
import pool from '../db.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fflate = require('fflate');
const Papa = require('papaparse');

const router = express.Router();

const CKAN_API_URL =
  'https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=6f710997-b5f9-4347-893b-1a47ddb61437';

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve('./uploads/quebec-registry');

// Ensure the upload directory exists at startup
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/** Validate that a filename contains only safe characters (no null bytes, path separators, etc.) */
function isSafeFileName(name: string): boolean {
  return /^[a-zA-Z0-9._\-]+$/.test(name);
}

// POST /api/quebec/registry-download
// Returns download URL and metadata from the Quebec open-data CKAN API.
// Replaces the former `supabase.functions.invoke('quebec-registry-download')` call.
router.post('/registry-download', async (_req: Request, res: Response) => {
  try {
    const ckanResponse = await fetch(CKAN_API_URL);
    if (!ckanResponse.ok) {
      const errText = await ckanResponse.text();
      return res.status(502).json({
        success: false,
        error: `CKAN API error: ${ckanResponse.status}`,
      });
    }

    const ckanData = await ckanResponse.json();
    const result = ckanData.result;
    const metadataModified: string = result.metadata_modified;
    const dataVersion = new Date(metadataModified).toISOString();

    const resources: any[] = result.resources || [];
    const zipResource = resources.find(
      (r) =>
        r.format?.toLowerCase() === 'zip' ||
        r.name?.toLowerCase().includes('zip') ||
        r.url?.toLowerCase().includes('.zip'),
    );

    if (!zipResource) {
      return res.status(404).json({
        success: false,
        error: 'No ZIP file resource found in the dataset',
      });
    }

    const downloadUrl: string = zipResource.url;
    const ts = new Date().toISOString().split('T')[0];
    const suggestedFileName = `quebec_business_registry_${ts}_${dataVersion.split('T')[0]}.zip`;

    return res.json({
      success: true,
      manual: true,
      message:
        'Use downloadUrl to fetch the ZIP manually, then upload it via POST /api/quebec/upload',
      version: dataVersion,
      metadata_modified: metadataModified,
      downloadUrl,
      fileName: suggestedFileName,
      upload: { path: suggestedFileName, token: null },
    });
  } catch (error: any) {
    console.error('Quebec registry-download error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/quebec/upload
// Receives a raw ZIP binary body (Content-Type: application/octet-stream).
// Query parameter `fileName` is used as the on-disk filename.
// Replaces the former `supabase.storage.from('quebec-registry').uploadToSignedUrl()` call.
// Note: the 500 MB limit matches the typical Quebec registry ZIP size (~400–500 MB).
router.post(
  '/upload',
  express.raw({ type: 'application/octet-stream', limit: '500mb' }),
  (req: Request, res: Response) => {
    const rawName = (req.query.fileName as string) || `upload_${Date.now()}.zip`;
    // Sanitize: keep only safe characters, then take the basename
    const baseName = path.basename(rawName);
    if (!isSafeFileName(baseName)) {
      return res.status(400).json({ error: 'Invalid fileName: only alphanumeric characters, dots, hyphens and underscores are allowed' });
    }
    const destPath = path.join(UPLOAD_DIR, baseName);

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Request body is empty or not a binary buffer' });
    }

    fs.writeFile(destPath, req.body, (err) => {
      if (err) {
        console.error('Quebec upload write error:', err);
        return res.status(500).json({ error: 'Failed to save uploaded file' });
      }
      return res.json({ success: true, path: baseName, size: req.body.length });
    });
  },
);

// POST /api/quebec/parse-csv
// Extracts the first CSV from the uploaded ZIP and upserts records into Neon.
// Replaces the former `supabase.functions.invoke('quebec-csv-parser')` call.
router.post('/parse-csv', async (req: Request, res: Response) => {
  const { fileName, analysisType = 'full' } = req.body as {
    fileName?: string;
    analysisType?: string;
  };

  if (!fileName) {
    return res.status(400).json({ error: 'fileName is required' });
  }

  const baseName = path.basename(fileName);
  if (!isSafeFileName(baseName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }
  const filePath = path.join(UPLOAD_DIR, baseName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: `File not found: ${baseName}. Please upload the file first via POST /api/quebec/upload`,
    });
  }

  try {
    const zipBuffer = fs.readFileSync(filePath);

    // Decompress ZIP using fflate (synchronous unzip)
    const decompressed = fflate.unzipSync(new Uint8Array(zipBuffer)) as Record<string, Uint8Array>;
    const csvEntry = Object.entries(decompressed).find(([name]) =>
      name.toLowerCase().endsWith('.csv'),
    );

    if (!csvEntry) {
      return res.status(422).json({ error: 'No CSV file found inside the ZIP archive' });
    }

    const [csvFileName, csvData] = csvEntry as [string, Uint8Array];
    const csvText = Buffer.from(csvData).toString('utf-8');
    console.log(`Parsing CSV: ${csvFileName} (${csvText.length} chars)`);

    // Parse CSV header to decide column mapping
    const parseResult = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      delimiter: ',',
    });

    if (parseResult.errors.length > 0) {
      console.warn('CSV parse warnings:', parseResult.errors.slice(0, 5));
    }

    const rows: Record<string, string>[] = parseResult.data;
    console.log(`Parsed ${rows.length} rows from ${csvFileName}`);

    if (analysisType === 'summary') {
      return res.json({
        success: true,
        summary: { totalRows: rows.length, csvFile: csvFileName },
      });
    }

    // Upsert rows into quebec_entities (batch of 500)
    const client = await pool.connect();
    let inserted = 0;
    let skipped = 0;

    try {
      await client.query('BEGIN');

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        for (const row of batch) {
          const neq =
            row['NEQ'] || row['neq'] || row["Numéro d'entreprise du Québec (NEQ)"] || '';
          if (!neq) {
            skipped++;
            continue;
          }

          const nomEntreprise =
            row['Nom'] || row['nom_entreprise'] || row["Nom de l'entreprise"] || '';
          const formeJuridique =
            row['Forme juridique'] ||
            row['forme_juridique'] ||
            row['Code de la forme juridique'] ||
            '';
          const statutEntreprise =
            row['Statut'] || row['statut_entreprise'] || row["Statut de l'entreprise"] || '';
          const dateImmatriculation =
            row['Date immatriculation'] ||
            row['date_immatriculation'] ||
            row["Date d'immatriculation"] ||
            null;
          const dateRadiation =
            row['Date radiation'] || row['date_radiation'] || row['Date de radiation'] || null;

          await client.query(
            `INSERT INTO quebec_entities
               (neq, nom_entreprise, forme_juridique, statut_entreprise,
                date_immatriculation, date_radiation, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (neq) DO UPDATE SET
               nom_entreprise      = EXCLUDED.nom_entreprise,
               forme_juridique     = EXCLUDED.forme_juridique,
               statut_entreprise   = EXCLUDED.statut_entreprise,
               date_immatriculation = EXCLUDED.date_immatriculation,
               date_radiation      = EXCLUDED.date_radiation,
               updated_at          = NOW()`,
            [
              neq,
              nomEntreprise || null,
              formeJuridique || null,
              statutEntreprise || null,
              dateImmatriculation || null,
              dateRadiation || null,
            ],
          );
          inserted++;
        }
      }

      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }

    // Record the import in quebec_registry_downloads
    await pool.query(
      `INSERT INTO quebec_registry_downloads
         (file_name, file_size, download_date, status, records_processed)
       VALUES ($1, $2, NOW(), 'completed', $3)
       ON CONFLICT DO NOTHING`,
      [baseName, zipBuffer.length, inserted],
    );

    return res.json({
      success: true,
      summary: {
        csvFile: csvFileName,
        totalRows: rows.length,
        inserted,
        skipped,
      },
    });
  } catch (error: any) {
    console.error('Quebec parse-csv error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
TSEOF
  echo "[OK]   Created $DEST"
fi

# ---------------------------------------------------------------------------
# 5. Register /api/quebec routes in server/index.ts
# ---------------------------------------------------------------------------
FILE="server/index.ts"
if [ ! -f "$FILE" ]; then
  echo "[WARN] $FILE not found – skipping"
elif grep -q "quebecRoutes\|/api/quebec" "$FILE"; then
  echo "[SKIP] $FILE already has quebec routes"
else
  python3 - "$FILE" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

import_line = "import filesRoutes from './routes/files.js';"
route_line  = "app.use('/api/files', filesRoutes);"
new_import  = "import quebecRoutes from './routes/quebec.js';"
new_route   = "app.use('/api/quebec', quebecRoutes);"

errors = []
if import_line not in content:
    errors.append(f"Could not find: {import_line!r}")
if route_line not in content:
    errors.append(f"Could not find: {route_line!r}")
if errors:
    print("[ERROR] " + "; ".join(errors))
    print("        Please add the following lines to server/index.ts manually:")
    print(f"        {new_import}")
    print(f"        {new_route}")
    sys.exit(1)

content = content.replace(import_line, import_line + '\n' + new_import, 1)
content = content.replace(route_line,  route_line  + '\n' + new_route,  1)
with open(path, 'w') as f:
    f.write(content)
print(f"[OK]   Registered /api/quebec routes in {path}")
PYEOF
fi

echo ""
echo "✅  All changes applied. Verifying TypeScript..."
if npx tsc --noEmit 2>&1 && npx tsc --project tsconfig.node.json --noEmit 2>&1; then
  echo "✅  TypeScript OK — commit with:"
  echo "    git add server/routes/quebec.ts server/index.ts src/components/admin/QuebecTestDownload.tsx src/integrations/supabase/client.ts src/utils/processQuebecRegistry.ts"
  echo "    git commit -m 'Fix Quebec registry download: supabase is not defined after Neon migration'"
else
  echo "❌  TypeScript errors found — see output above"
fi
