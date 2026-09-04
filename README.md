# The Bespoke Investment Company — Site bilingue FR/EN

## Structure
- `index.html` : choix de langue
- `fr/` : site en français
- `en/` : site en anglais
- `assets/` : styles, photos, scripts (communs)
- `netlify/functions/` : fonctions serverless (auth, wallet, messages, admin)
- `sql/` : schéma et seeds Postgres

---

## Variables d'environnement requises

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DATABASE_URL` | ✅ | Connection string Neon Postgres (ex: `postgresql://user:pass@host/db?sslmode=require`) |
| `SESSION_SECRET` | ✅ | Clé HMAC pour la signature des sessions (min. 32 caractères aléatoires) |
| `ADMIN_PASSWORD` | ✅ | Mot de passe de l'interface admin `/admin/` |
| `GITHUB_TOKEN` | ✅ | Personal Access Token GitHub (scope `repo`) pour les commits stock |
| `GITHUB_OWNER` | ✅ | Owner du dépôt GitHub (ex: `AlexKree`) |
| `GITHUB_REPO` | ✅ | Nom du dépôt GitHub (ex: `Bespoke`) |
| `ANTHROPIC_API_KEY` | ⚡ optionnel | Clé API Claude pour les trois outils IA. **Si absente, les outils renvoient un message invitant à utiliser le formulaire de contact — le reste du site fonctionne normalement.** |
| `ANTHROPIC_MODEL` | ⚡ optionnel | Modèle utilisé (défaut : `claude-opus-5`) |
| `RESEND_API_KEY_V2` | ⚡ optionnel | Clé API Resend pour l'envoi des emails de vérification. Si absent, le lien est loggé en console. |
| `RESEND_FROM_EMAIL` | ⚡ optionnel | Adresse d'envoi (défaut : `contact@thebespokecar.com`) |

À renseigner dans **Netlify → Site settings → Environment variables**.

---

## Mise en place de la base de données (Neon)

1. Créer un projet sur [neon.tech](https://neon.tech)
2. Copier la **connection string** (format `postgresql://...?sslmode=require`)
3. L'ajouter en variable d'environnement `DATABASE_URL` dans Netlify
4. Exécuter le schéma dans la console SQL Neon :
   ```sql
   -- Contenu de sql/schema.sql
   ```
   Ou via `psql` :
   ```bash
   psql "$DATABASE_URL" -f sql/schema.sql
   ```

---

## Initialisation des comptes staff

Le compte staff ne se crée jamais avec un mot de passe en clair. La procédure utilise des tokens d'invitation à usage unique.

**Étape 1 — Créer les tokens** (dans la console SQL Neon) :
```sql
-- Contenu de sql/seed-staff.sql
INSERT INTO staff_invites (email, token, role, expires_at)
VALUES
  ('pierre.cohen71@gmail.com', encode(gen_random_bytes(32), 'hex'), 'staff', now() + interval '7 days'),
  ('contact@thebespokecar.com', encode(gen_random_bytes(32), 'hex'), 'staff', now() + interval '7 days')
ON CONFLICT (email) DO UPDATE
  SET token = encode(gen_random_bytes(32), 'hex'), used = FALSE, expires_at = now() + interval '7 days';

SELECT email, token FROM staff_invites;
```

**Étape 2 — Envoyer le lien** à chaque staff member :
```
https://thebespokecar.com/setup-staff.html?token=<TOKEN_COPIÉ>
```

**Étape 3** — La personne choisit son mot de passe via le formulaire. Après validation, son compte est actif avec le rôle `staff`.

---

## Développement local

Prérequis : Node 18, [Netlify CLI](https://docs.netlify.com/cli/get-started/)

```bash
npm install
# Créer un fichier .env à la racine :
# DATABASE_URL=postgresql://...
# SESSION_SECRET=...
# ADMIN_PASSWORD=...
# GITHUB_TOKEN=...
# GITHUB_OWNER=AlexKree
# GITHUB_REPO=Bespoke
# RESEND_API_KEY_V2=... (optionnel)

netlify dev
```

Le site est disponible sur `http://localhost:8888`.

---

## Remplacer les photos

Les photos sont dans `assets/photos/`. Remplacez un fichier en gardant exactement le même nom :
- `hero.jpg`
- `car-01.jpg` … `car-11.jpg`
- `import-01.jpg` … `import-05.jpg`
- `workshop-01.jpg` … `workshop-11.jpg`
- `partner-iconic.jpg`, `team.jpg`

---

## Interface Admin

Accessible à `/admin/` — requiert `ADMIN_PASSWORD`.
- Upload de photos vers `assets/stock/images/` (max 5 Mo/fichier, 20 fichiers/requête)
- Mise à jour de `stock.json` (les véhicules affichés sur la page Stock)

### Accès admin (sans compte utilisateur)

- L'accès admin est **password-only** : aucun login utilisateur n'est requis.
- Le mot de passe est lu côté serveur depuis `ADMIN_PASSWORD` (Netlify).
- Un mot de passe invalide retourne un refus d'accès (`401`).
- Une session admin légère est conservée côté navigateur pour éviter de ressaisir le mot de passe à chaque rechargement.

Configuration Netlify : **Site settings → Environment variables** puis ajouter `ADMIN_PASSWORD`.
En local (`netlify dev`), définir `ADMIN_PASSWORD` dans `.env`.

---

---

## Outils IA

Trois outils publics, chacun servi par une fonction Netlify. La clé API reste côté serveur.

| Outil | Page | Fonction | Quota / IP / heure |
|-------|------|----------|--------------------|
| Concierge de sourcing | `/fr/concierge`, `/en/concierge` | `ai-concierge.js` | 12 |
| Calculateur d'import | `/fr/import`, `/en/import` | `ai-import-cost.js` | 12 |
| Pré-rapport photo | `/fr/inspection`, `/en/inspection` | `ai-inspection.js` | 5 |

### Séparation des rôles sur le calculateur d'import

Aucun montant n'est produit par le modèle. La chaîne est en trois temps :

1. le modèle **extrait** les paramètres du texte libre (prix, origine, année, CO2…) ;
2. `netlify/lib/import-cost.js` **calcule**, à partir d'une table de taux explicite ;
3. le modèle **explique** le chiffrage déjà calculé, sans pouvoir le modifier.

**La table `RATES` dans `netlify/lib/import-cost.js` doit être revue à chaque loi de finances** (barème du malus, TVA, droits de douane, tarif du cheval fiscal). Elle porte un champ `reference_year` affiché à l'utilisateur.

### Limitation de débit

Deux niveaux, en cascade :
- un compteur en mémoire, immédiat mais limité à une instance de fonction ;
- la table `ai_usage` en Postgres, partagée entre instances.

Appliquer la migration pour activer le second niveau :

```bash
psql "$DATABASE_URL" -f migrations/add-ai-usage.sql
```

Sans cette table, les fonctions continuent de répondre en se rabattant sur le compteur mémoire.
La table grossit indéfiniment : prévoir une purge (`DELETE FROM ai_usage WHERE created_at < now() - interval '7 days';`).

### Coût indicatif par appel

Mesuré sur des cas réels avec `claude-opus-5` :

| Outil | Tokens entrée / sortie | Coût approximatif |
|-------|------------------------|-------------------|
| Concierge | ~3 500 / 1 350 | ~0,05 $ |
| Calculateur d'import | ~2 × appel | ~0,10 $ |
| Pré-rapport photo (3 photos) | ~7 400 / 4 100 | ~0,14 $ |

Le catalogue envoyé au concierge est mis en cache côté API (`cache_control`), ce qui réduit le coût des appels rapprochés. Les photos sont redimensionnées dans le navigateur à 1 400 px avant envoi : sans cela, le coût du pré-rapport serait plusieurs fois supérieur.

### Garde-fous

- Toute réponse publique porte une mention « indicatif, non contractuel », en français et en anglais.
- Le concierge ne peut recommander que des véhicules présents dans `stock.json` : le serveur ne renvoie au front que des fiches issues du catalogue, jamais du texte libre du modèle.
- Le pré-rapport photo refuse par construction de conclure sur l'état mécanique, l'historique ou l'authenticité, et ne donne jamais d'estimation de prix.

---

## Fiches véhicule et SEO

Chaque véhicule de `stock.json` a sa propre page, sa propre URL et son balisage `schema.org`.

```
/fr/stock/ford-mustang-gt-v8-4-6l-2005.html
/en/stock/ford-mustang-gt-v8-4-6l-2005.html
```

### Génération

Les pages sont **générées au build**, pas commitées (voir `.gitignore`) :

```bash
node scripts/build-stock-pages.mjs
```

C'est la commande `[build]` de `netlify.toml`. Un enregistrement depuis `/admin` commite `stock.json`, ce qui déclenche un déploiement Netlify, qui régénère les pages. Aucune action manuelle.

Le script produit aussi `sitemap.xml` (69 URL, les véhicules vendus exclus) et `robots.txt`. Il repart d'un dossier vide à chaque exécution : un véhicule retiré de `stock.json` ne laisse pas de page orpheline.

Il signale en fin d'exécution les fiches sans photo et les images référencées mais absentes du disque.

### Schéma de `stock.json`

Le fichier mélangeait trois générations de schéma. `scripts/normalize-stock.mjs` a convergé vers un format unique (idempotent, rejouable) :

| Champ | Rôle |
|-------|------|
| `id` | **Clé stable — ne jamais modifier.** Référencée par `reservations.vehicle_slug` en base. |
| `slug` | URL publique. Écrit une fois puis conservé, pour qu'une URL publiée ne se casse pas si le titre change. |
| `vehicle_type` | `car` ou `motorcycle` — détermine le type `schema.org` (`Car` / `Motorcycle`). |
| `make`, `model` | Chaînes simples (une marque ne se traduit pas). Alimentent le filtre par marque. |
| `price_eur` | Entier ou `null` (= prix sur demande). |
| `mileage`, `mileage_km` | Chaîne libre pour l'affichage, entier pour `schema.org`. |
| `country`, `status`, `sale_category`, `images` | Inchangés. Chemins d'images normalisés en absolu. |

### Référencement

- `Car` / `Motorcycle` + `Offer` (prix, disponibilité, état) + `BreadcrumbList` sur chaque fiche.
- Véhicules vendus en `noindex,follow` et exclus du sitemap : ils restent accessibles comme référence sans polluer l'index.
- `hreflang` FR/EN croisé, canonique par page, Open Graph avec la photo du véhicule.

## À compléter

Adresse, email, téléphone, hébergeur (mentions légales). Les champs sont marqués `[À RENSEIGNER]`.
