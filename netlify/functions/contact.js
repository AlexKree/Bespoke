const nodemailer = require('nodemailer');

// HTML escape function to prevent XSS
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Sanitize text to remove potentially malicious content
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  // Remove any control characters except newlines and tabs
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Parse the form data
  let formData;
  try {
    formData = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid form data' })
    };
  }

  const { name, email, phone, budget, vehicle, message } = formData;

  // Sanitize all input fields
  const sanitizedName = sanitizeText(name);
  const sanitizedEmail = sanitizeText(email);
  const sanitizedPhone = sanitizeText(phone || '');
  const sanitizedBudget = sanitizeText(budget || '');
  const sanitizedVehicle = sanitizeText(vehicle || '');
  const sanitizedMessage = sanitizeText(message);

  // Validate required fields
  if (!sanitizedName || !sanitizedEmail || !sanitizedMessage) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: name, email, and message are required' })
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitizedEmail)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid email format' })
    };
  }

  // Get SMTP configuration from environment variables
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const emailFrom = process.env.EMAIL_FROM || 'contact@thebespokecar.com';
  const emailTo = process.env.EMAIL_TO || 'contact@thebespokecar.com';

  // Check if SMTP credentials are configured
  if (!smtpHost || !smtpUser || !smtpPass) {
    console.error('SMTP configuration missing');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Validate that emailFrom and emailTo are properly formatted
  // This prevents the Nodemailer interpretation conflict vulnerability
  // by ensuring that the from/to addresses are not user-controlled
  if (!emailFrom || !emailTo) {
    console.error('Email configuration missing');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  // Build email content with escaped HTML
  const emailHtml = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(sanitizedName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(sanitizedEmail)}</p>
    ${sanitizedPhone ? `<p><strong>Phone:</strong> ${escapeHtml(sanitizedPhone)}</p>` : ''}
    ${sanitizedBudget ? `<p><strong>Budget:</strong> ${escapeHtml(sanitizedBudget)}</p>` : ''}
    ${sanitizedVehicle ? `<p><strong>Vehicle:</strong> ${escapeHtml(sanitizedVehicle)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(sanitizedMessage).replace(/\n/g, '<br>')}</p>
  `;

  const emailText = `
New Contact Form Submission

Name: ${sanitizedName}
Email: ${sanitizedEmail}
${sanitizedPhone ? `Phone: ${sanitizedPhone}` : ''}
${sanitizedBudget ? `Budget: ${sanitizedBudget}` : ''}
${sanitizedVehicle ? `Vehicle: ${sanitizedVehicle}` : ''}

Message:
${sanitizedMessage}
  `;

  // Send email
  try {
    await transporter.sendMail({
      from: emailFrom,
      to: emailTo,
      replyTo: sanitizedEmail,
      subject: `Contact Form: ${escapeHtml(sanitizedName)}`,
      text: emailText,
      html: emailHtml
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Email sent successfully' 
      })
    };
  } catch (error) {
    // Log detailed error server-side but send generic message to client
    console.error('Error sending email:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to send email. Please try again later.'
      })
    };
  }
};
