# PWA Setup — The Bespoke Investment Company

## Qu'est-ce qu'une PWA ?

Une **Progressive Web App (PWA)** est un site web qui peut être installé directement sur l'écran d'accueil d'un iPhone ou d'un smartphone Android, sans passer par l'App Store ni Google Play. Une fois installée, elle s'ouvre comme une application native (sans barre d'adresse du navigateur) et fonctionne partiellement hors ligne grâce au service worker.

---

## Comment installer sur iPhone (Safari)

1. Ouvrir **Safari** (obligatoire — Chrome et Firefox ne supportent pas l'installation PWA sur iOS)
2. Naviguer sur le site (`thebespokecar.com`)
3. Attendre que la page soit entièrement chargée
4. Appuyer sur l'icône **Partager** (carré avec flèche ↑) en bas de l'écran
5. Faire défiler le menu vers le bas
6. Appuyer sur **"Sur l'écran d'accueil"**
7. Optionnel : modifier le nom → appuyer sur **"Ajouter"**

L'icône dorée apparaît sur l'écran d'accueil. L'app s'ouvre sans la barre Safari.

---

## Comment installer sur Android (Chrome)

1. Ouvrir **Chrome**
2. Naviguer sur le site
3. Une bannière **"Ajouter à l'écran d'accueil"** apparaît automatiquement (ou via le menu ⋮ → "Installer l'application")
4. Confirmer l'installation

---

## Remplacer les icônes placeholder

Les icônes actuelles (`assets/icons/icon-192.svg` et `icon-512.svg`) sont des SVG simples avec la lettre "B" dorée sur fond sombre. Pour des icônes professionnelles :

1. Créer ou commander deux PNG :
   - `assets/icons/icon-192.png` — 192 × 192 px
   - `assets/icons/icon-512.png` — 512 × 512 px
2. Mettre à jour `manifest.json` pour pointer vers les PNG :
   ```json
   "icons": [
     { "src": "/assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
     { "src": "/assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
   ]
   ```
3. Mettre à jour la balise Apple dans `index.html`, `fr/index.html` et `en/index.html` :
   ```html
   <link rel="apple-touch-icon" href="/assets/icons/icon-192.png" />
   ```

**Outil recommandé :** [maskable.app](https://maskable.app/editor) pour vérifier le rendu "maskable" (Android adaptatif).

---

## Tester en local

Le service worker nécessite **HTTPS** ou `localhost`. Pour tester localement :

```bash
# Option 1 — serve (simple)
npx serve .

# Option 2 — Netlify CLI (reproduit l'environnement de production)
npm install -g netlify-cli
netlify dev
```

Ensuite ouvrir `http://localhost:3000` (ou le port indiqué). Vérifier dans Chrome DevTools → Application → Service Workers que le SW est bien enregistré.

---

## Fichiers PWA

| Fichier | Rôle |
|---|---|
| `/manifest.json` | Métadonnées de l'app (nom, icônes, couleurs, orientation) |
| `/sw.js` | Service worker — cache offline + stratégie réseau |
| `/assets/icons/icon-192.svg` | Icône 192 × 192 px |
| `/assets/icons/icon-512.svg` | Icône 512 × 512 px |
| `/offline.html` | Page affichée quand l'utilisateur est hors ligne |

---

## Limitations

- **Pas dans l'App Store / Google Play** — c'est voulu (pas de frais, pas de validation Apple/Google)
- **HTTPS obligatoire** en production — déjà garanti par Netlify ✅
- Sur iOS, certaines fonctionnalités avancées (push notifications) restent limitées par Apple
- Le service worker ne s'active qu'après le **premier chargement complet** de la page
