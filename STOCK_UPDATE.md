# Update the stock

This site is static. To add/remove/update cars **without regenerating the whole site**, you only edit a JSON file and (optionally) add photos.

---

## Option A — Interface d'administration (recommandé)

Une interface d'administration est disponible à l'URL `/admin/`.
Elle permet d'ajouter, modifier, marquer vendu ou supprimer des véhicules sans toucher à Git.

### Configuration initiale (Netlify)

Définir les variables d'environnement suivantes dans **Netlify → Site settings → Environment variables** :

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Mot de passe de connexion à l'interface admin |
| `GITHUB_TOKEN` | Personal Access Token GitHub avec permissions **Contents: Read & Write** sur ce dépôt (fine-grained token) ou scope `repo` (classic token) |
| `GITHUB_OWNER` | Propriétaire du dépôt, ex. `AlexKree` |
| `GITHUB_REPO` | Nom du dépôt, ex. `Bespoke` |

> **Créer un GitHub Token** : GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → New token → sélectionner ce dépôt → Contents: Read & Write.

### Fonctionnalités

- ✅ Ajouter un véhicule (avec tous les champs FR/EN)
- ✏️ Modifier une fiche existante
- 🔴 Marquer vendu (badge VENDU affiché en rouge sur le site, annonce conservée)
- ✅ Remettre disponible
- 🗑 Supprimer définitivement

> **Photos** : l'upload d'images via l'interface n'est pas supporté.
> Les photos doivent être déposées manuellement dans `assets/stock/images/` (voir Option B ci-dessous).

---

## Option B — Édition directe (développeurs)

### 1) Add photos (optional but recommended)

1. Put your images in:
   `assets/stock/images/`

2. Use short, lowercase filenames (e.g. `ferrari-308-01.jpg`).
3. Commit/push the new images to GitHub.

### 2) Update the stock list

Edit:
`assets/stock/stock.json`

The list is in `items`. Each item must have:
- `id` (unique slug)
- `title` (FR/EN)
- `make`, `model` (FR/EN)
- `year` (number)
- `mileage_km` (number or `null`)
- `price_eur` (number or `null`)
  - if `null`, the site shows **"Prix sur demande" / "Price on request"**
- `status`: `"available"` or `"sold"`
  - sold items show a **VENDU / SOLD** badge on the card
  - the stock page shows **available only** by default with a toggle to include sold
- `location` (FR/EN)
- `headline` (FR/EN)
- `description` (FR/EN)
- `images`: array of image paths (use paths like `assets/stock/images/xxx.jpg`)

### Example entry

```json
{
  "id": "porsche-911-997-carrera-s",
  "make": { "fr": "Porsche", "en": "Porsche" },
  "model": { "fr": "911 (997) Carrera S", "en": "911 (997) Carrera S" },
  "year": 2006,
  "mileage_km": 82000,
  "price_eur": null,
  "status": "available",
  "location": { "fr": "France / Europe", "en": "France / Europe" },
  "headline": { "fr": "Configuration élégante, historique limpide.", "en": "Elegant spec, clean history." },
  "description": { "fr": "Informations complètes sur demande.", "en": "Full details on request." },
  "images": [
    "assets/stock/images/997-01.jpg",
    "assets/stock/images/997-02.jpg"
  ],
  "title": { "fr": "Porsche 911 (997) Carrera S", "en": "Porsche 911 (997) Carrera S" }
}
```

### 3) Publish

Commit and push. Netlify will update automatically after the build finishes.

## Where it appears

- French stock page: `fr/stock.html`
- English stock page: `en/stock.html`
