#!/usr/bin/env bash
# =============================================================================
# Appliquer les 4 corrections sur la branche copilot/replace-supabase-with-postgresql-again
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

echo "=== Fix 2 : useCompanyVerification.ts — ajouter import supabase ==="
# N'ajouter que si pas déjà présent
if ! grep -q "import { supabase } from '@/integrations/supabase/client'" \
  src/hooks/client/useCompanyVerification.ts; then
  sed -i "1s|^|import { supabase } from '@/integrations/supabase/client';\n|" \
    src/hooks/client/useCompanyVerification.ts
fi
echo "  OK"

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
echo "=== Vérification TypeScript (rapide) ==="
if command -v npx &>/dev/null; then
  npx tsc --noEmit --skipLibCheck 2>&1 | tail -20 || true
else
  echo "  npx non disponible — vérification TypeScript ignorée"
fi

echo ""
echo "=== Toutes les corrections ont été appliquées ==="
echo "Prochaine étape : git add -p && git commit && git push"
