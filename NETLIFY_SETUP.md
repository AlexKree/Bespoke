# Netlify Contact Form Setup

This contact form uses Netlify Functions and SendGrid to send emails to contact@thebespokecar.com.

## Setup Instructions

### 1. Configure SendGrid

1. Create a SendGrid account at https://sendgrid.com
2. Create an API key with "Mail Send" permissions
3. Verify your sender email (contact@thebespokecar.com) in SendGrid

### 2. Configure Netlify Environment Variables

In your Netlify site settings:
1. Go to Site settings > Build & deploy > Environment
2. Add the following environment variable:
   - Key: `SENDGRID_API_KEY`
   - Value: Your SendGrid API key

### 3. Deploy to Netlify

1. Connect your GitHub repository to Netlify
2. Netlify will automatically detect the `netlify.toml` configuration
3. Deploy the site

### 4. Install Dependencies (if testing locally)

```bash
npm install
```

## Testing Locally

To test the Netlify Functions locally:

```bash
npm install netlify-cli -g
netlify dev
```

Make sure to set the `SENDGRID_API_KEY` environment variable in a `.env` file:

```
SENDGRID_API_KEY=your_api_key_here
```

## Files Modified/Created

- `netlify.toml` - Netlify configuration
- `package.json` - Dependencies
- `netlify/functions/contact.js` - Serverless function for handling form submissions
- `assets/contact-form.js` - Client-side JavaScript for form handling
- `assets/styles.css` - Added styles for success/error messages
- `fr/contact.html` - Updated French contact form
- `en/contact.html` - Updated English contact form
- `.gitignore` - Git ignore rules for node_modules, etc.

## How It Works

1. User fills out the contact form
2. JavaScript intercepts the form submission
3. Form data is sent to `/.netlify/functions/contact` endpoint
4. Netlify Function validates the data and uses SendGrid to send email
5. Email is sent to contact@thebespokecar.com with reply-to set to user's email
6. User sees success or error message
