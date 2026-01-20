const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Parse the form data
    const data = JSON.parse(event.body);
    const { name, email, phone, budget, vehicle, message } = data;

    // Validate required fields
    if (!name || !email || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Create transporter using environment variables for SMTP credentials
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    // Email content
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.SMTP_TO || 'contact@thebespokecar.com',
      subject: `Contact Form - The Bespoke Car Company - ${name}`,
      text: `
New contact form submission:

Name/Company: ${name}
Email: ${email}
Phone: ${phone || 'N/A'}
Budget: ${budget || 'N/A'}
Vehicle: ${vehicle || 'N/A'}

Message:
${message}
      `,
      html: `
<h2>New contact form submission</h2>
<p><strong>Name/Company:</strong> ${name}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Phone:</strong> ${phone || 'N/A'}</p>
<p><strong>Budget:</strong> ${budget || 'N/A'}</p>
<p><strong>Vehicle:</strong> ${vehicle || 'N/A'}</p>
<h3>Message:</h3>
<p>${message.replace(/\n/g, '<br>')}</p>
      `,
      replyTo: email
    };

    // Send email
    await transporter.sendMail(mailOptions);

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
