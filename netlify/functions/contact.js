const nodemailer = require('nodemailer');

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

  // Validate required fields
  if (!name || !email || !message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: name, email, and message are required' })
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid email format' })
    };
  }

  // Get SMTP configuration from environment variables
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT || 587;
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

  // Build email content
  const emailHtml = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
    ${budget ? `<p><strong>Budget:</strong> ${budget}</p>` : ''}
    ${vehicle ? `<p><strong>Vehicle:</strong> ${vehicle}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${message.replace(/\n/g, '<br>')}</p>
  `;

  const emailText = `
New Contact Form Submission

Name: ${name}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}
${budget ? `Budget: ${budget}` : ''}
${vehicle ? `Vehicle: ${vehicle}` : ''}

Message:
${message}
  `;

  // Send email
  try {
    await transporter.sendMail({
      from: emailFrom,
      to: emailTo,
      replyTo: email,
      subject: `Contact Form: ${name}`,
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
    console.error('Error sending email:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to send email',
        details: error.message 
      })
    };
  }
};
