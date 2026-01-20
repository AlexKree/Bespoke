const sgMail = require('@sendgrid/mail');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Set up CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Parse the request body
    const data = JSON.parse(event.body);
    const { name, email, phone, budget, vehicle, message } = data;

    // Validate required fields
    if (!name || !email || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Name, email, and message are required' })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid email address' })
      };
    }

    // Check for SendGrid API key
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error('SENDGRID_API_KEY is not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Initialize SendGrid
    sgMail.setApiKey(apiKey);

    // Prepare email content
    const emailContent = `
New contact form submission from Bespoke website:

Name/Company: ${name}
Email: ${email}
Phone: ${phone || 'Not provided'}
Budget: ${budget || 'Not provided'}
Vehicle: ${vehicle || 'Not provided'}

Message:
${message}

---
Sent from: ${event.headers.referer || 'Unknown'}
IP: ${event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'Unknown'}
`;

    // Prepare the email message
    const msg = {
      to: 'contact@thebespokecar.com',
      from: 'contact@thebespokecar.com',
      subject: `New Contact Form Submission - ${name}`,
      text: emailContent,
      replyTo: email
    };

    // Send the email
    await sgMail.send(msg);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Your message has been sent successfully' 
      })
    };

  } catch (error) {
    console.error('Error processing contact form:', error);
    
    // Handle SendGrid-specific errors
    if (error.response) {
      console.error('SendGrid error:', error.response.body);
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to send message. Please try again later.' 
      })
    };
  }
};
