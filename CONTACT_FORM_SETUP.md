# Configuration du Formulaire de Contact SMTP

Ce document explique comment configurer les variables d'environnement pour activer l'envoi d'emails via SMTP sur le site hébergé par Netlify.

## Variables d'Environnement Netlify

Pour que le formulaire de contact fonctionne, vous devez configurer les variables d'environnement suivantes dans les paramètres de votre site Netlify :

### Variables Obligatoires

| Variable | Description | Exemple pour Ionos |
|----------|-------------|-------------------|
| `SMTP_HOST` | Serveur SMTP | `smtp.ionos.fr` |
| `SMTP_USER` | Nom d'utilisateur SMTP (généralement votre email) | `contact@thebespokecar.com` |
| `SMTP_PASSWORD` | Mot de passe SMTP | `votre_mot_de_passe` |
| `SMTP_PORT` | Port SMTP | `587` (TLS) ou `465` (SSL) |
| `SMTP_SECURE` | Utiliser SSL/TLS | `false` pour port 587, `true` pour port 465 |

### Variables Optionnelles

| Variable | Description | Défaut |
|----------|-------------|--------|
| `SMTP_FROM` | Adresse email d'expéditeur | Utilise `SMTP_USER` |
| `SMTP_TO` | Adresse email de destination | `contact@thebespokecar.com` |

## Configuration Ionos Spécifique

Pour Ionos, utilisez ces paramètres :

```
SMTP_HOST=smtp.ionos.fr
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre-email@votredomaine.com
SMTP_PASSWORD=votre-mot-de-passe
SMTP_TO=contact@thebespokecar.com
```

## Comment Configurer dans Netlify

1. Connectez-vous à votre compte Netlify
2. Sélectionnez votre site
3. Allez dans **Site settings** → **Environment variables**
4. Cliquez sur **Add a variable**
5. Ajoutez chaque variable une par une avec sa valeur
6. Redéployez le site pour que les changements prennent effet

## Test du Formulaire

Une fois les variables configurées et le site redéployé :

1. Visitez la page de contact (`/fr/contact.html` ou `/en/contact.html`)
2. Remplissez tous les champs requis
3. Cliquez sur "Envoyer" / "Send"
4. Vous devriez voir un message de confirmation
5. Vérifiez votre boîte de réception pour l'email

## Dépannage

### Le formulaire ne s'envoie pas

- Vérifiez que toutes les variables d'environnement sont correctement configurées
- Vérifiez que le site a été redéployé après l'ajout des variables
- Consultez les logs Netlify Functions pour voir les erreurs

### Erreur d'authentification SMTP

- Vérifiez que `SMTP_USER` et `SMTP_PASSWORD` sont corrects
- Pour Ionos, assurez-vous d'utiliser le mot de passe de messagerie, pas le mot de passe du compte

### Erreur de connexion

- Vérifiez que `SMTP_HOST` est correct
- Vérifiez que `SMTP_PORT` correspond à `SMTP_SECURE` (587 avec false, 465 avec true)

## Sécurité

⚠️ **Important** :
- Ne jamais commiter les variables d'environnement dans le code
- Ne jamais partager vos identifiants SMTP publiquement
- Utilisez toujours les variables d'environnement Netlify pour stocker les credentials

## Architecture Technique

Le formulaire utilise :
- **Frontend** : HTML + JavaScript (`assets/contact.js`)
- **Backend** : Netlify Functions (serverless) avec Node.js et Nodemailer
- **SMTP** : Connexion sécurisée à votre serveur mail Ionos

Le processus :
1. L'utilisateur remplit le formulaire
2. JavaScript envoie les données à `/.netlify/functions/send-email` via AJAX
3. La fonction Netlify se connecte au serveur SMTP avec les credentials
4. L'email est envoyé via SMTP
5. Une réponse de succès/erreur est renvoyée à l'utilisateur

---

Pour plus d'informations techniques, consultez le fichier `netlify/functions/README.md`.
