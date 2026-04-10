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
| `RESEND_API_KEY` | ⚡ optionnel | Clé API Resend pour l'envoi des emails de vérification. Si absent, le lien est loggé en console. |
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
# RESEND_API_KEY=... (optionnel)

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

---

## À compléter

Adresse, email, téléphone, hébergeur (mentions légales). Les champs sont marqués `[À RENSEIGNER]`.

