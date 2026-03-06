# Corrections — branche `copilot/replace-supabase-with-postgresql-again`

## ⚡ Prochaines étapes — Ce qu'il faut faire maintenant

> **Patches 0001-0005 sont déjà appliqués.** Patch 0006 avait une corruption (`error: corrupt patch at line 505`) — **il a été corrigé**, téléchargez la nouvelle version ci-dessous.

```bash
# Depuis le dossier blockchain-bloom-works, sur la branche correcte :
git checkout copilot/replace-supabase-with-postgresql-again

# Télécharger le patch 0006 corrigé (version sans corruption)
curl -O https://raw.githubusercontent.com/AlexKree/Bespoke/copilot/fix-registry-file-loading-error/patches/blockchain-bloom-works/0006-fix-frontend-use-express-not-supabase.patch

# Appliquer
git apply --whitespace=fix 0006-fix-frontend-use-express-not-supabase.patch

# Vérifier (0 erreur TypeScript attendu)
npx tsc --noEmit --skipLibCheck

# Committer et pousser
git add src/components/admin/QuebecManualUpload.tsx \
        src/components/admin/QuebecRegistryManager.tsx \
        server/routes/quebec.ts
git commit -m "fix(quebec): route upload via Express not Supabase; add import-status endpoint"
git push
```

### Ce que le patch 0006 change exactement

| Fichier | Ce qui change |
|---------|---------------|
| `QuebecManualUpload.tsx` | Supprime tout le traitement ZIP navigateur + `supabase.functions.invoke('quebec-csv-insert')` → 2 `fetch()` vers Express |
| `QuebecRegistryManager.tsx` | Remplace `supabase.from('quebec_registry_metadata')` et `supabase.functions.invoke('quebec-registry-download')` → `fetch()` Express |
| `server/routes/quebec.ts` | Ajoute `GET /api/quebec/import-status` (avant `lookup-neq`) |

### Pourquoi le patch était corrompu

La ligne 502 du patch original contenait `-};+};` (deux tokens sur une ligne sans newline entre eux), car l'ancien `QuebecManualUpload.tsx` se terminait sans newline finale. Le patch corrigé a été re-généré proprement et vérifié (`git apply` → exit code 0).

---

## Statut des fixes

| Fix | Fichier | Statut |
|-----|---------|--------|
| Fix 1 | `src/integrations/supabase/client.ts` | ✅ Appliqué (commit 41ca118) |
| Fix 2 | `src/hooks/client/useCompanyVerification.ts` | ✅ Pas nécessaire |
| Fix 3 | `src/hooks/client/useClientDetailsData.ts` | ✅ Appliqué (commit 41ca118) |
| Fix 4 | `src/components/client/tabs/ComplianceTab.tsx` | ✅ Appliqué (commit ebd70ba) |
| Fix 5 | `server/routes/quebec.ts` | ✅ Appliqué (commit 9a5a864) — lookup-neq + search |
| **Fix 6** | `QuebecManualUpload.tsx`, `QuebecRegistryManager.tsx`, `server/routes/quebec.ts` | **⏳ À appliquer** — patch corrigé disponible |

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

### Fix 4 — `src/components/client/tabs/ComplianceTab.tsx` ✅ (commit ebd70ba)

`ComplianceTab.tsx` appelait `supabase.from('aml_checks')` **sans importer `supabase`** → `ReferenceError: supabase is not defined` à l'exécution.

**Corrections appliquées :**

- **Partie A** — Import ajouté ligne 2 :
  ```typescript
  import { supabase } from '@/integrations/supabase/client';
  ```

- **Partie B** — Destructuring simplifié (suppression de `isVerificationValid`) :
  ```typescript
  const { kycVerificationData } = useCompanyVerification(companyData?.["Registration number"]);
  ```

- **Partie C** — Vérification directe sur le statut :
  ```typescript
  const complianceItems = useComplianceItems(
    kycVerificationData?.status === 'verified',
  ```

---

## Application automatique (tous les fixes d'un coup)

> **Tous les fixes ont été appliqués manuellement.** Le script ci-dessous est conservé comme référence pour ré-appliquer les corrections sur une nouvelle branche.

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

---

## Analyse — API du Registre des entreprises du Québec (REQ)

### Question posée
> « Il existe une API pour le registre des entreprises du Québec. Cela serait plus simple pour se connecter et demander uniquement ce qu'on a besoin. Faut-il basculer vers cette API ou garder le système actuel ? »

### Résultat de la recherche

#### ❌ Pas d'API REST officielle

Il **n'existe pas d'API REST officielle et publique** fournie par le Registraire des entreprises du Québec pour des requêtes à la demande (lookup par NEQ, recherche par nom, etc.).

Les seuls accès officiels sont :
| Source | Type | Mise à jour | Usage |
|--------|------|-------------|-------|
| [Données Québec](https://www.donneesquebec.ca/recherche/dataset/registre-des-entreprises) | Téléchargement ZIP/CSV | Toutes les 2 semaines | Licence CC-BY-NC-SA (usage non-commercial) |
| [Site REQ](https://registreentreprises.gouv.qc.ca) | Interface web (formulaire) | Temps réel | Usage humain uniquement |

#### ⚠️ Bibliothèques non-officielles

Une bibliothèque TypeScript/npm non-officielle existe :
- **`@jpmonette/req`** ([GitHub](https://github.com/jpmonette/req-ts)) — émule les requêtes HTTP du site web officiel pour récupérer les infos d'une entreprise par NEQ
- Avantages : requêtes en temps réel, pas de stockage
- **Inconvénients majeurs** :
  - Non-officielle (scraping du site gouvernemental)
  - Risque de rupture si le gouvernement modifie son site
  - Possiblement contraire aux CGU du site
  - Maintenance incertaine (bibliothèque archivée)

### ✅ Recommandation : garder le système actuel + ajouter les endpoints de lookup

**Garder le système bulk import** comme source principale car :
1. Données officielles, stables, bien documentées
2. Mises à jour toutes les 2 semaines (suffisant pour la conformité KYC/AML)
3. Performance optimale (requêtes PostgreSQL locales < 1 ms vs appel réseau externe)
4. Pas de dépendance externe fragile

**Ce qu'on a ajouté** (patch `0005`) : deux nouveaux endpoints qui exploitent la DB locale :

```
GET /api/quebec/lookup-neq/:neq
  → Retourne les données complètes d'une entreprise par son NEQ (10 chiffres)
  → 200 + {found: true, company: {...}} si trouvée
  → 404 + {found: false, message: "..."} si absente de la DB

GET /api/quebec/search?q=<nom>&limit=20
  → Recherche plein-texte (ILIKE) sur le nom de l'entreprise
  → Tri : correspondance exacte > début du nom > contient
  → Maximum 100 résultats
```

### Appliquer le patch 0005

```bash
# Dans blockchain-bloom-works :
git apply patches/blockchain-bloom-works/0005-add-neq-lookup-and-search-endpoints.patch
# OU manuellement — ajouter les 2 router.get() avant "export default router" dans server/routes/quebec.ts
git add server/routes/quebec.ts
git commit -m "feat(quebec): add GET /lookup-neq/:neq and GET /search endpoints"
git push
```

### Tester les nouveaux endpoints

```bash
# Lookup par NEQ (doit être dans la DB après import CSV)
curl http://localhost:3001/api/quebec/lookup-neq/1143920115

# Recherche par nom
curl "http://localhost:3001/api/quebec/search?q=Bombardier&limit=5"

# Test validation NEQ invalide
curl http://localhost:3001/api/quebec/lookup-neq/123   # → 400 "must be exactly 10 digits"
```

---

## Architecture de stockage — Où va le fichier du registre québécois ?

> **Question :** *« Où devrait être stocké le fichier pour ne pas charger inutilement Neon ? »*

### Réponse courte : le système actuel est déjà correct

| Donnée | Stockage | Raison |
|--------|----------|--------|
| Fichier ZIP brut (~400 Mo) | **Disque local du serveur** (`uploads/quebec-registry/*.zip`) | Fichier temporaire de traitement — jamais dans une DB |
| Données parsées (~500k entreprises) | **Neon** (table `quebec_entities`) | Données structurées, interrogeables via index |
| Log des imports | **Neon** (table `quebec_registry_downloads`) | Une seule ligne par import — négligeable |

### Neon est utilisé de façon raisonnable

L'import bulk (~500k `INSERT/UPDATE`) ne se produit **qu'une fois toutes les 2 semaines** (fréquence de mise à jour de Données Québec). Ce n'est pas une charge continue.

Une fois les données dans Neon, les requêtes `GET /lookup-neq/:neq` et `GET /search?q=...` sont rapides car PostgreSQL utilise ses index.

### Ce qu'il ne faut PAS faire

- ❌ Stocker le fichier ZIP dans Neon (inutile — c'est un binaire, pas des données relationnelles)
- ❌ Importer le registre **toutes les nuits** si les données ne changent que toutes les 2 semaines
- ❌ Ajouter une base SQLite ou un autre moteur de stockage — Neon suffit

### Fréquence d'import recommandée

Configurer le job d'import pour s'exécuter **bi-hebdomadaire** (tous les 15 jours), en vérifiant d'abord si `metadata_modified` de l'API CKAN a changé avant de lancer le téléchargement et l'import.

---

## Un fichier de 263 Mo peut-il tenir sur le serveur Express ?

> **Question :** *« Est-ce qu'un fichier de 263 Mo peut tenir sur le serveur Express ? »*

### Réponse courte : **Oui sur disque — mais le vrai problème était dans le navigateur**

#### Disque (pas un problème)
263 Mo sur disque est trivial pour n'importe quel serveur moderne. Railway, Render, Fly.io fournissent au moins 1–5 Go de stockage éphémère. Le fichier ZIP est écrit dans `uploads/quebec-registry/` et n'occupe pas Neon du tout.

> ⚠️ Exception : **Vercel** (serverless) a un système de fichiers **en lecture seule** en production. Si le serveur Express tourne sur Vercel, l'upload sur disque ne fonctionnera pas. Utiliser Railway, Render ou Fly.io à la place.

#### RAM — c'était le vrai problème (corrigé par patch 0006)

Avant le patch 0006, **tout le traitement se faisait dans le navigateur** :

```
Navigateur : charge 263 Mo en mémoire
           + décompresse le ZIP → CSV ~800 Mo en RAM
           + PapaParse parse ~800 Mo en RAM
           + envoie des batches à supabase.functions.invoke('quebec-csv-insert')  ← CASSÉ
```

**Peak RAM navigateur ≈ 1,5 Go** → crash possible sur mobile ou machines limitées.

Après le patch 0006, le navigateur **n'ouvre jamais** le fichier :

```
Navigateur : stream le ZIP vers POST /api/quebec/upload  (minimal RAM)
Serveur    : lit le ZIP (263 Mo RAM)
           + décompresse → CSV (~800 Mo RAM)
           + insère dans Neon par batches de 500
```

**Peak RAM serveur ≈ 1 Go** — acceptable pour un serveur Node.js standard (512 Mo min recommandé).

#### Résumé

| Aspect | Avant patch 0006 | Après patch 0006 |
|--------|-----------------|-----------------|
| Traitement ZIP | ❌ Navigateur (crash possible) | ✅ Serveur Express |
| Appels DB | ❌ `supabase.functions.invoke` (Supabase) | ✅ Neon via Express |
| Disque serveur | ✅ Déjà correct | ✅ Inchangé |
| RAM navigateur pic | ❌ ~1,5 Go | ✅ < 1 Mo |

---

## Patch 0006 — Corriger le flux d'import (frontend → Express, pas Supabase)

### Problème corrigé

`QuebecManualUpload.tsx` appelait encore `supabase.functions.invoke('quebec-csv-insert')` et traitait le ZIP entier dans le navigateur. `QuebecRegistryManager.tsx` appelait `supabase.from('quebec_registry_metadata')` pour vérifier le statut.

### Fichiers modifiés

| Fichier | Changement |
|---------|-----------|
| `src/components/admin/QuebecManualUpload.tsx` | Supprime tout le code de parsing navigateur ; upload le ZIP vers `POST /api/quebec/upload` puis appelle `POST /api/quebec/parse-csv` |
| `src/components/admin/QuebecRegistryManager.tsx` | Remplace `supabase.from(...)` et `supabase.functions.invoke(...)` par des appels Express |
| `server/routes/quebec.ts` | Ajoute `GET /api/quebec/import-status` pour le statut du registre |

### Appliquer le patch 0006

```bash
# Dans blockchain-bloom-works :
git apply patches/blockchain-bloom-works/0006-fix-frontend-use-express-not-supabase.patch
# OU lancer le script complet :
bash patches/blockchain-bloom-works/apply-all-fixes.sh
git add src/components/admin/QuebecManualUpload.tsx \
        src/components/admin/QuebecRegistryManager.tsx \
        server/routes/quebec.ts
git commit -m "fix(quebec): route upload/parse via Express, not Supabase; add import-status endpoint"
git push
```

### Tester le nouveau endpoint import-status

```bash
curl http://localhost:3001/api/quebec/import-status
# → {"totalRecords": 542180, "lastImportDate": "2026-02-14T...", "lastImportFile": "...zip"}
```
