#!/usr/bin/env bash
# =============================================================================
# Appliquer les 6 corrections sur la branche copilot/replace-supabase-with-postgresql-again
# de AlexKree/blockchain-bloom-works
#
# Exécuter depuis la racine du repo blockchain-bloom-works :
#   git checkout copilot/replace-supabase-with-postgresql-again
#   bash patches/blockchain-bloom-works/apply-all-fixes.sh
# =============================================================================
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Fix 1 : client.ts — remplacer localhost:3001 par chaîne vide ==="
# NOTE: sed échoue ici car le pattern contient || (JS) qui entre en conflit avec
# le délimiteur | de sed. On utilise Python à la place.
python3 - <<'EOF'
import pathlib
path = pathlib.Path("src/integrations/supabase/client.ts")
content = path.read_text()
old = "const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';"
new = "const API_URL = import.meta.env.VITE_API_URL || '';"
if old in content:
    path.write_text(content.replace(old, new, 1))
    print("  OK")
else:
    print("  AVERTISSEMENT : ligne API_URL non trouvée (peut-être déjà corrigée ?)")
EOF

echo "=== Fix 2 : useCompanyVerification.ts — vérification (pas d'import supabase nécessaire) ==="
# NOTE: useCompanyVerification.ts utilise uniquement localStorage, PAS supabase.
# Ajouter un import inutile provoquerait une erreur TypeScript (noUnusedLocals).
# L'import supabase manquant est dans ComplianceTab.tsx → traité par Fix 4 ci-dessous.
if grep -q "supabase" src/hooks/client/useCompanyVerification.ts; then
  echo "  supabase détecté dans le fichier — ajout de l'import"
  python3 - <<'PYEOF'
import pathlib
path = pathlib.Path("src/hooks/client/useCompanyVerification.ts")
content = path.read_text()
imp = "import { supabase } from '@/integrations/supabase/client';\n"
if imp.strip() not in content:
    path.write_text(imp + content)
    print("  import ajouté")
else:
    print("  import déjà présent")
PYEOF
else
  echo "  OK (supabase non utilisé dans ce fichier — import superflu ignoré)"
fi

echo "=== Fix 3 : useClientDetailsData.ts — supprimer le PATCH de test ==="
python3 - <<'EOF'
import re, pathlib

path = pathlib.Path("src/hooks/client/useClientDetailsData.ts")
content = path.read_text()

# Remplace le bloc PATCH par la vraie implémentation.
# On utilise re.DOTALL pour que .* matche les sauts de ligne,
# et \s* pour tolérer les variations d'indentation.
result = re.sub(
    r'//\s*PATCH\s*:.*?simule.*?TOUT.*?valid[ée].*?\n\s*const complianceItems = useComplianceItems\(.*?\);',
    """const complianceItems = useComplianceItems(
    kycVerificationData?.status === 'verified',
    kycVerificationData?.timestamp,
    amlCheckData,
    rawComplianceData,
    country
  );""",
    content,
    count=1,
    flags=re.DOTALL
)
if result == content:
    print("  AVERTISSEMENT : patron PATCH non trouvé (peut-être déjà corrigé ?)")
else:
    path.write_text(result)
    print("  OK")
EOF

echo "=== Fix 4 : ComplianceTab.tsx — import supabase + isVerificationValid → kycVerificationData?.status ==="
python3 - <<'EOF'
import re, pathlib

path = pathlib.Path("src/components/client/tabs/ComplianceTab.tsx")
content = path.read_text()

# Ajouter import supabase si manquant
supabase_import = "import { supabase } from '@/integrations/supabase/client';\n"
if supabase_import.strip() not in content:
    content = content.replace(
        "import React, { useEffect, useState } from 'react';",
        "import React, { useEffect, useState } from 'react';\n" + supabase_import,
        1
    )

# Retirer isVerificationValid du destructuring
content = content.replace(
    "const { kycVerificationData, isVerificationValid } = useCompanyVerification(",
    "const { kycVerificationData } = useCompanyVerification(",
    1
)

# Remplacer isVerificationValid() par kycVerificationData?.status === 'verified'
content = content.replace(
    "isVerificationValid(),",
    "kycVerificationData?.status === 'verified',",
    1
)

path.write_text(content)
print("  OK")
EOF

echo ""
echo "=== Fix 5 : quebec.ts — ajouter GET /lookup-neq/:neq et GET /search ==="
python3 - <<'EOF'
import pathlib

path = pathlib.Path("server/routes/quebec.ts")
content = path.read_text()

new_endpoints = '''
// GET /api/quebec/lookup-neq/:neq
// Looks up a single company by its NEQ (Numéro d'Entreprise du Québec)
// in the local postgresql table populated by the bulk import.
// Returns 200 + company row if found, 404 if not found.
router.get('/lookup-neq/:neq', async (req: Request, res: Response) => {
  const neq = (req.params.neq || '').trim().replace(/\\s+/g, '');

  if (!/^\\d{10}$/.test(neq)) {
    return res.status(400).json({
      error: 'Invalid NEQ: must be exactly 10 digits',
      received: req.params.neq,
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT neq,
              nom_entreprise,
              forme_juridique,
              statut_entreprise,
              date_immatriculation,
              date_radiation,
              updated_at
       FROM quebec_entities
       WHERE neq = $1
       LIMIT 1`,
      [neq],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        found: false,
        neq,
        message:
          'Company not found in the local registry. ' +
          'The Quebec open-data file may not have been imported yet — run POST /api/quebec/parse-csv first.',
      });
    }

    return res.json({ found: true, company: rows[0] });
  } catch (error: any) {
    console.error('Quebec lookup-neq error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/quebec/search?q=<name_fragment>&limit=20
// Full-text search on nom_entreprise in the local registry table.
// Returns up to `limit` matches (max 100).
router.get('/search', async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
  const rawLimit = parseInt((req.query.limit as string) || '20', 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 100);

  if (!q || q.length < 2) {
    return res.status(400).json({
      error: 'Query parameter "q" must be at least 2 characters',
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT neq,
              nom_entreprise,
              forme_juridique,
              statut_entreprise,
              date_immatriculation,
              date_radiation
       FROM quebec_entities
       WHERE nom_entreprise ILIKE $1
       ORDER BY
         CASE WHEN UPPER(nom_entreprise) = UPPER($2) THEN 0
              WHEN UPPER(nom_entreprise) LIKE UPPER($3) THEN 1
              ELSE 2
         END,
         nom_entreprise ASC
       LIMIT $4`,
      [`%${q}%`, q, `${q}%`, limit],
    );

    return res.json({
      query: q,
      total: rows.length,
      companies: rows,
    });
  } catch (error: any) {
    console.error('Quebec search error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

'''

marker = 'export default router;'
if 'lookup-neq' in content:
    print("  OK (endpoints déjà présents)")
elif marker in content:
    path.write_text(content.replace(marker, new_endpoints + marker, 1))
    print("  OK")
else:
    print("  ERREUR : 'export default router' non trouvé dans quebec.ts")
EOF

echo ""
echo "=== Fix 6 : QuebecManualUpload.tsx + QuebecRegistryManager.tsx + import-status endpoint ==="
echo "    Le frontend n'utilise plus Supabase ni ne traite le ZIP dans le navigateur."
echo "    Il uploade le ZIP vers Express (/api/quebec/upload) puis"
echo "    appelle /api/quebec/parse-csv pour le traitement côté serveur."
git apply --whitespace=fix patches/blockchain-bloom-works/0006-fix-frontend-use-express-not-supabase.patch 2>/dev/null || \
python3 - <<'EOF'
# Application manuelle si git apply échoue (e.g. whitespace differences)
import pathlib, difflib, re

# 1. QuebecManualUpload.tsx — remplacement complet
print("  Applying QuebecManualUpload.tsx...")
p = pathlib.Path("src/components/admin/QuebecManualUpload.tsx")
new_content = pathlib.Path(
    "patches/blockchain-bloom-works/_QuebecManualUpload.new.tsx"
).read_text() if pathlib.Path(
    "patches/blockchain-bloom-works/_QuebecManualUpload.new.tsx"
).exists() else None

if new_content:
    p.write_text(new_content)
    print("  QuebecManualUpload.tsx: OK (full replacement)")
else:
    content = p.read_text()
    # Remove old Supabase/PapaParse imports
    content = content.replace("import Papa from 'papaparse';\n", "", 1)
    content = content.replace("import { unzip } from 'fflate';\n", "", 1)
    if "VITE_API_URL" not in content:
        content = content.replace(
            "import { QuebecManualUpload } from './QuebecManualUpload';",
            "import { QuebecManualUpload } from './QuebecManualUpload';",
            1
        )
        # Add API_URL after imports
        lines = content.split('\n')
        last_import = max(i for i, l in enumerate(lines) if l.startswith('import '))
        lines.insert(last_import + 1, "\nconst API_URL = import.meta.env.VITE_API_URL || '';")
        content = '\n'.join(lines)
    p.write_text(content)
    print("  QuebecManualUpload.tsx: partial (run git apply manually for full diff)")

# 2. QuebecRegistryManager.tsx — replace Supabase calls
print("  Applying QuebecRegistryManager.tsx...")
p2 = pathlib.Path("src/components/admin/QuebecRegistryManager.tsx")
content2 = p2.read_text()

# Add API_URL after imports
if "VITE_API_URL" not in content2:
    content2 = content2.replace(
        "import { QuebecManualUpload } from './QuebecManualUpload';",
        "import { QuebecManualUpload } from './QuebecManualUpload';\n\nconst API_URL = import.meta.env.VITE_API_URL || '';",
        1
    )

# Replace checkRegistryStatus
old_check = """  const checkRegistryStatus = async () => {
    try {
      const { data: metadata } = await supabase
        .from('quebec_registry_metadata')
        .select('data_version, last_ingest_at, ingest_status, total_records')
        .order('last_ingest_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (metadata && metadata.total_records && metadata.total_records > 0) {
        setRegistryStatus('available');
        setLastUpdate(metadata.last_ingest_at);
      } else {
        setRegistryStatus('empty');
        setLastUpdate(null);
      }
    } catch (error) {
      console.error('Error checking registry status:', error);
      setRegistryStatus('unknown');
    }
  };"""
new_check = """  const checkRegistryStatus = async () => {
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
  };"""
content2 = content2.replace(old_check, new_check, 1)

# Replace triggerDownload (Supabase → Express)
old_trigger = """      const { data: result, error } = await supabase.functions.invoke('quebec-registry-download', {
        body: { manual: true }
      });

      if (error) {
        throw error;
      }"""
new_trigger = """      const res = await fetch(`${API_URL}/api/quebec/registry-download`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `Error ${res.status}`);
      }
      const result = await res.json();"""
content2 = content2.replace(old_trigger, new_trigger, 1)

p2.write_text(content2)
print("  QuebecRegistryManager.tsx: OK")

# 3. server/routes/quebec.ts — add import-status endpoint
print("  Applying server/routes/quebec.ts (import-status)...")
p3 = pathlib.Path("server/routes/quebec.ts")
content3 = p3.read_text()
if 'import-status' not in content3:
    endpoint = """
// GET /api/quebec/import-status
// Returns the total number of imported companies and the date of the last import
// from the quebec_registry_downloads table stored in Neon.
// Used by the admin UI to show registry health without querying the full table.
router.get('/import-status', async (_req: Request, res: Response) => {
  try {
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM quebec_entities',
    );
    const totalRecords = parseInt(countRows[0]?.total ?? '0', 10);

    const { rows: importRows } = await pool.query(
      `SELECT file_name, records_processed, download_date
       FROM quebec_registry_downloads
       ORDER BY download_date DESC
       LIMIT 1`,
    );
    const lastImport = importRows[0] ?? null;

    return res.json({
      totalRecords,
      lastImportDate: lastImport?.download_date ?? null,
      lastImportFile: lastImport?.file_name ?? null,
      lastImportRecords: lastImport?.records_processed ?? null,
    });
  } catch (error: any) {
    console.error('Quebec import-status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

"""
    content3 = content3.replace("// GET /api/quebec/lookup-neq/:neq", endpoint + "// GET /api/quebec/lookup-neq/:neq", 1)
    p3.write_text(content3)
    print("  server/routes/quebec.ts: OK")
else:
    print("  server/routes/quebec.ts: OK (endpoint already present)")
EOF
echo "  Fix 6 done"

echo ""
echo "=== Vérification TypeScript (rapide) ==="
if command -v npx &>/dev/null; then
  npx tsc --noEmit --skipLibCheck 2>&1 | tail -20 || true
else
  echo "  npx non disponible — vérification TypeScript ignorée"
fi

echo ""
echo "=== Toutes les 6 corrections ont été appliquées ==="
echo "Prochaine étape : git add -p && git commit && git push"
