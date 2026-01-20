# Contact Form with SMTP Configuration

This directory contains the Netlify serverless function for sending contact form emails via SMTP.

## Environment Variables

The following environment variables must be configured in your Netlify site settings:

### Required Variables

- `SMTP_HOST` - Your SMTP server hostname (e.g., `smtp.ionos.fr` for Ionos)
- `SMTP_USER` - Your SMTP username/email address
- `SMTP_PASSWORD` - Your SMTP password
- `SMTP_PORT` - SMTP port (default: 587 for TLS, or 465 for SSL)
- `SMTP_SECURE` - Set to `true` for port 465 (SSL), `false` for port 587 (TLS)

### Optional Variables

- `SMTP_FROM` - The "from" email address (defaults to SMTP_USER if not set)
- `SMTP_TO` - The recipient email address (defaults to contact@thebespokecar.com if not set)

## Ionos SMTP Configuration

For Ionos hosting, typical values are:

```
SMTP_HOST=smtp.ionos.fr
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yourdomain.com
SMTP_PASSWORD=your-password
SMTP_TO=contact@thebespokecar.com
```

## Testing Locally

To test the function locally with Netlify CLI:

```bash
# Install dependencies
cd netlify/functions
npm install

# Create a .env file with your SMTP credentials
# Then run the Netlify dev server from the root directory
cd ../..
netlify dev
```

## Security Notes

- Never commit your SMTP credentials to version control
- The `.env` file is ignored by git via `.gitignore`
- Environment variables should only be configured in Netlify's dashboard
