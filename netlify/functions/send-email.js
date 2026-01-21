const nodemailer = require('nodemailer');

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, subject = '', message, ['bot-field']: botField } = body || {};

  // Basic checks
  if (botField) {
    // honeypot filled -> likely spam
    return { statusCode: 400, body: JSON.stringify({ error: 'Spam detected' }) };
  }
  if (!name || !email || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  if (typeof message === 'string' && message.length > 20000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Message too long' }) };
  }

  // Read SMTP config from environment variables
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = (process.env.SMTP_SECURE === 'true'); // true for 465, false for 587
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || 'contact@thebespokecar.com';
  const to = process.env.EMAIL_TO || 'contact@thebespokecar.com';

  if (!host || !user || !pass) {
    console.error('SMTP configuration missing (SMTP_HOST/SMTP_USER/SMTP_PASS).');
    return { statusCode: 500, body: JSON.stringify({ error: 'SMTP not configured' }) };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  const subjectLine = `Contact form submission: ${name}${subject ? ' — ' + subject : ''}`;
  const text = `Nom/Name: ${name}
Email: ${email}
Sujet/Subject: ${subject}
Message:
${message}
`;

  const html = `<p><strong>Nom / Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p><strong>Sujet / Subject:</strong> ${escapeHtml(subject)}</p>
<p><strong>Message:</strong><br/>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`;

  const mailOptions = {
    from,
    to,
    subject: subjectLine,
    text,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error sending email:', err && err.message ? err.message : err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send email' }) };
  }
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}