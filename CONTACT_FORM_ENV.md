# Contact Form Environment Variables

The contact form requires the following environment variables to be configured in Netlify:

## Required Variables

- **SMTP_HOST**: The SMTP server hostname (e.g., `smtp.ionos.com` for Ionos)
- **SMTP_PORT**: The SMTP server port (default: `587` for TLS, `465` for SSL)
- **SMTP_USER**: The SMTP username/email for authentication
- **SMTP_PASS**: The SMTP password for authentication

## Optional Variables

- **EMAIL_FROM**: The "from" email address (default: `contact@thebespokecar.com`)
- **EMAIL_TO**: The "to" email address where form submissions are sent (default: `contact@thebespokecar.com`)

## Example Configuration for Ionos

```
SMTP_HOST=smtp.ionos.com
SMTP_PORT=587
SMTP_USER=contact@thebespokecar.com
SMTP_PASS=your-password-here
EMAIL_FROM=contact@thebespokecar.com
EMAIL_TO=contact@thebespokecar.com
```

## Setting Environment Variables in Netlify

1. Go to your Netlify site dashboard
2. Navigate to Site settings > Environment variables
3. Add each variable with its corresponding value
4. Redeploy your site for the changes to take effect

## Security Notes

- Never commit SMTP credentials to the repository
- Use Netlify's environment variables interface to securely store credentials
- The Netlify function will only be accessible via POST requests from your domain
