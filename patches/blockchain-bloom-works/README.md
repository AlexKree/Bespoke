# Corrections — branche `copilot/replace-supabase-with-postgresql-again`

## Statut des fixes

| Fix | Fichier | Statut |
|-----|---------|--------|
| Fix 1 | `src/integrations/supabase/client.ts` | ✅ Appliqué (commit 41ca118) |
| Fix 2 | `src/hooks/client/useCompanyVerification.ts` | ✅ Pas nécessaire — fichier n'utilise pas supabase |
| Fix 3 | `src/hooks/client/useClientDetailsData.ts` | ✅ Appliqué (commit 41ca118) |
| Fix 4 | `src/components/client/tabs/ComplianceTab.tsx` | ❌ **À appliquer** |

## Problèmes identifiés dans les logs

```
ClientDetails.tsx:70 Is KYC verified: false
ClientDetails.tsx:71 KYC verification data: null
ClientDetails.tsx:72 AML check data (from hook): null
localhost:3001/api/quebec/registry-download — ERR_CONNECTION_REFUSED
```

## Détail des 4 fixes

### Fix 1 — `src/integrations/supabase/client.ts` (ligne 4) ✅

**Avant :**
```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
```
**Après :**
```typescript
const API_URL = import.meta.env.VITE_API_URL || '';
```
→ Remplace `localhost:3001` (connexion refusée en production) par une chaîne vide.
  Avec `''` les appels deviennent des URLs relatives (`/api/...`) ce qui fonctionne :
  - **En dev** si Vite est configuré avec un proxy vers `localhost:3001`
  - **En production** si le frontend et le backend partagent le même domaine
  - Assurez-vous que `VITE_API_URL` est bien renseigné dans les variables d'environnement Vercel/Codespaces si frontend et backend sont sur des domaines différents

---

### Fix 2 — `src/hooks/client/useCompanyVerification.ts` ✅ (pas nécessaire)

Ce fichier utilise uniquement `localStorage`, **pas** `supabase`.
Ajouter un import inutile provoquerait une erreur TypeScript (`noUnusedLocals`).
L'import `supabase` manquant se trouve dans `ComplianceTab.tsx` → traité par Fix 4.

---

### Fix 3 — `src/hooks/client/useClientDetailsData.ts` (~lignes 109-125) ✅

**Avant :**
```typescript
// PATCH : simule TOUT validé pour test front !
const complianceItems = useComplianceItems(
  true,
  (new Date()).toISOString(),
  {
    status: "completed",
    check_date: (new Date()).toISOString(),
    risk_level: "low"
  },
  {
    status: "compliant",
    last_checked: (new Date()).toISOString()
  },
  "France"
);
```
**Après :**
```typescript
const complianceItems = useComplianceItems(
  kycVerificationData?.status === 'verified',
  kycVerificationData?.timestamp,
  amlCheckData,
  rawComplianceData,
  country
);
```
→ Supprime les données de test codées en dur (KYC, AML, France)

---

### Fix 4 — `src/components/client/tabs/ComplianceTab.tsx` ❌ CRITIQUE

`ComplianceTab.tsx` appelle `supabase.from('aml_checks')` **sans importer `supabase`** → `ReferenceError: supabase is not defined` à l'exécution.

**Commande à exécuter dans le terminal blockchain-bloom-works :**

```bash
python3 - <<'PYEOF'
import pathlib

path = pathlib.Path("src/components/client/tabs/ComplianceTab.tsx")
content = path.read_text()

# A — Ajouter l'import supabase manquant
imp = "import { supabase } from '@/integrations/supabase/client';\n"
if imp.strip() not in content:
    content = content.replace(
        "import React, { useEffect, useState } from 'react';",
        "import React, { useEffect, useState } from 'react';\n" + imp,
        1
    )
    print("  import supabase ajouté")
else:
    print("  import supabase déjà présent")

# B — Retirer isVerificationValid du destructuring
content = content.replace(
    "const { kycVerificationData, isVerificationValid } = useCompanyVerification(",
    "const { kycVerificationData } = useCompanyVerification(",
    1
)

# C — Remplacer isVerificationValid() par kycVerificationData?.status === 'verified'
content = content.replace(
    "isVerificationValid(),",
    "kycVerificationData?.status === 'verified',",
    1
)

path.write_text(content)
print("  Fix 4 OK")
PYEOF
```

Puis :
```bash
git add src/components/client/tabs/ComplianceTab.tsx
git commit -m "Fix 4: add missing supabase import and fix isVerificationValid in ComplianceTab"
git push
```

---

## Application automatique (tous les fixes d'un coup)

```bash
# Depuis la racine de blockchain-bloom-works :
git checkout copilot/replace-supabase-with-postgresql-again
bash patches/blockchain-bloom-works/apply-all-fixes.sh
git add src/integrations/supabase/client.ts \
        src/hooks/client/useClientDetailsData.ts \
        src/components/client/tabs/ComplianceTab.tsx
git commit -m "Fix regressions: localhost fallback, PATCH test data, missing supabase import in ComplianceTab"
git push
```

## Note sur les données AML toujours à null

La table `aml_checks` n'est pas encore implémentée dans le `TableQuery` du `client.ts`. Il faut :
1. Ajouter un endpoint `GET /api/aml-checks?company_name=...&registration_number=...` côté Express
2. Ajouter le cas `aml_checks` dans `TableQuery.execute()` du `client.ts`
