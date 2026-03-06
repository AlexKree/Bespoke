#!/usr/bin/env bash
# =============================================================================
# Appliquer les 5 corrections sur la branche copilot/replace-supabase-with-postgresql-again
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
echo "=== Vérification TypeScript (rapide) ==="
if command -v npx &>/dev/null; then
  npx tsc --noEmit --skipLibCheck 2>&1 | tail -20 || true
else
  echo "  npx non disponible — vérification TypeScript ignorée"
fi

echo ""
echo "=== Toutes les corrections ont été appliquées ==="
echo "Prochaine étape : git add -p && git commit && git push"
