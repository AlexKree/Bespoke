# Update the stock (GitHub Pages)

This site is static. To add/remove/update cars **without regenerating the whole site**, you only edit a JSON file and (optionally) add photos.

## 1) Add photos (optional but recommended)

1. Put your images in:
   `assets/stock/images/`

2. Use short, lowercase filenames (e.g. `ferrari-308-01.jpg`).
3. Commit/push the new images to GitHub.

## 2) Update the stock list

Edit:
`assets/stock/stock.json`

The list is in `items`. Each item must have:
- `id` (unique slug)
- `title` (FR/EN)
- `make`, `model` (FR/EN)
- `year` (number)
- `mileage_km` (number or `null`)
- `price_eur` (number or `null`)  
  - if `null`, the site shows **“Prix sur demande” / “Price on request”**
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

## 3) Publish

Commit and push. GitHub Pages will update automatically after the build finishes.

## Where it appears

- French stock page: `fr/stock.html`
- English stock page: `en/stock.html`
