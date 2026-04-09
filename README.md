# The Bespoke Investment Company — Site bilingue FR/EN (v1)

## Structure
- `index.html` : choix de langue
- `fr/` : site en français
- `en/` : site en anglais
- `assets/` : styles + photos (communs)

## Remplacer les photos (image par image)
Les photos utilisées sont dans `assets/photos/`.

Remplacez un fichier en gardant exactement le même nom :
- `hero.jpg`
- `car-01.jpg`, `car-02.jpg`, `car-03.jpg`
- `import-01.jpg`, `import-02.jpg`, `import-03.jpg`
- `workshop-01.jpg`, `workshop-02.jpg`, `workshop-03.jpg`
- `partner-iconic.jpg`, `team.jpg`

## Auth & backend setup (Neon + SMTP)

### Variables d'environnement Netlify

| Variable | Obligatoire | Description |
|----------|:-----------:|-------------|
| `NEON_DATABASE_URL` | ✅ | Connection string Neon Postgres |
| `SESSION_SECRET` | ✅ | Clé HMAC (32+ caractères aléatoires) pour signer les tokens de session |
| `SMTP_HOST` | ✅ | Serveur SMTP (ex. `smtp.mailgun.org`) |
| `SMTP_PORT` | ✅ | Port SMTP (ex. `587`) |
| `SMTP_SECURE` | ✅ | `true` pour port 465, `false` pour 587/STARTTLS |
| `SMTP_USER` | ✅ | Identifiant SMTP |
| `SMTP_PASS` | ✅ | Mot de passe SMTP |
| `EMAIL_FROM` | ✅ | Adresse expéditeur (ex. `contact@thebespokecar.com`) |

> En développement local (sans les variables SMTP), le lien de vérification est affiché dans les logs Netlify (`VERIFY LINK (dev fallback): ...`).

### Initialiser la base de données

```bash
psql "$NEON_DATABASE_URL" -f sql/schema.sql
```

Ou copiez le contenu de `sql/schema.sql` dans la console SQL Neon ([console.neon.tech](https://console.neon.tech)).

### Créer les comptes staff

Éditez `sql/seed-staff.sql` pour renseigner les adresses email, puis :

```bash
psql "$NEON_DATABASE_URL" -f sql/seed-staff.sql
```

Récupérez les tokens générés et partagez l'URL de setup avec chaque membre staff :

```
https://thebespokecar.com/setup-staff.html?token=<token>
```

## À compléter
Adresse, email, téléphone, hébergeur (mentions légales). Les champs sont marqués `[À RENSEIGNER]`.

## Preview locale
Ouvrez `index.html` dans votre navigateur.


Ajouts v2 :
- `car-04.jpg`, `car-05.jpg`, `car-06.jpg`
- `import-04.jpg`, `import-05.jpg`
- `workshop-04.jpg`, `workshop-05.jpg`, `workshop-06.jpg`, `workshop-07.jpg`


Ajouts v2.2 :
- `car-07.jpg` à `car-11.jpg`
- `workshop-08.jpg` à `workshop-11.jpg`
