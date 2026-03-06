# Corrections — branche `copilot/replace-supabase-with-postgresql-again`

## Problèmes identifiés dans les logs

```
ClientDetails.tsx:70 Is KYC verified: false
ClientDetails.tsx:71 KYC verification data: null
ClientDetails.tsx:72 AML check data (from hook): null
localhost:3001/api/quebec/registry-download — ERR_CONNECTION_REFUSED
```

## 4 fichiers à corriger

### Fix 1 — `src/integrations/supabase/client.ts` (ligne 4)

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

### Fix 2 — `src/hooks/client/useCompanyVerification.ts` (ligne 1)

**Avant :** (premier import est `useState, useEffect`)

**Après :** ajouter en tout premier :
```typescript
import { supabase } from '@/integrations/supabase/client';
```

---

### Fix 3 — `src/hooks/client/useClientDetailsData.ts` (~lignes 109-125)

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

### Fix 4 — `src/components/client/tabs/ComplianceTab.tsx`

**Partie A** — Ajouter l'import manquant après la ligne `import React...` :
```typescript
import { supabase } from '@/integrations/supabase/client';
```

**Partie B** — Ligne ~27 :
```typescript
// Avant :
const { kycVerificationData, isVerificationValid } = useCompanyVerification(companyData?.["Registration number"]);
// Après :
const { kycVerificationData } = useCompanyVerification(companyData?.["Registration number"]);
```

**Partie C** — Ligne ~73 :
```typescript
// Avant :
const complianceItems = useComplianceItems(
  isVerificationValid(),
// Après :
const complianceItems = useComplianceItems(
  kycVerificationData?.status === 'verified',
```

---

## Application automatique (si terminal disponible)

```bash
cd /path/to/blockchain-bloom-works
git checkout copilot/replace-supabase-with-postgresql-again
bash patches/blockchain-bloom-works/apply-all-fixes.sh
git add src/integrations/supabase/client.ts \
        src/hooks/client/useCompanyVerification.ts \
        src/hooks/client/useClientDetailsData.ts \
        src/components/client/tabs/ComplianceTab.tsx
git commit -m "Fix 4 regressions: localhost fallback, PATCH test data, missing supabase imports"
git push
```

## Note sur les données AML toujours à null

La table `aml_checks` n'est pas encore implémentée dans le `TableQuery` du `client.ts`. Il faut :
1. Ajouter un endpoint `GET /api/aml-checks?company_name=...&registration_number=...` côté Express
2. Ajouter le cas `aml_checks` dans `TableQuery.execute()` du `client.ts`
