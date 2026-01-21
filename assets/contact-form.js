// Contact Form Handler
(function() {
  'use strict';

  const contactForm = document.getElementById('contact-form');
  const submitButton = contactForm ? contactForm.querySelector('button[type="submit"]') : null;
  const statusMessage = document.getElementById('form-status');

  if (!contactForm) {
    return; // Exit if contact form is not on this page
  }

  contactForm.addEventListener('submit', async function(event) {
    event.preventDefault();

    // Disable submit button to prevent double submission
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = submitButton.dataset.sending || 'Sending...';
    }

    // Clear previous status message
    if (statusMessage) {
      statusMessage.textContent = '';
      statusMessage.className = '';
    }

    // Get form data
    const formData = {
      name: contactForm.querySelector('[name="name"]').value.trim(),
      email: contactForm.querySelector('[name="email"]').value.trim(),
      phone: contactForm.querySelector('[name="phone"]') ? contactForm.querySelector('[name="phone"]').value.trim() : '',
      budget: contactForm.querySelector('[name="budget"]') ? contactForm.querySelector('[name="budget"]').value.trim() : '',
      vehicle: contactForm.querySelector('[name="vehicle"]') ? contactForm.querySelector('[name="vehicle"]').value.trim() : '',
      message: contactForm.querySelector('[name="message"]').value.trim()
    };

    try {
      const response = await fetch('/.netlify/functions/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (response.ok) {
        // Success
        if (statusMessage) {
          statusMessage.textContent = statusMessage.dataset.success || 'Message sent successfully! We will get back to you soon.';
          statusMessage.className = 'form-status success';
        }
        // Reset form
        contactForm.reset();
      } else {
        // Error from server
        if (statusMessage) {
          statusMessage.textContent = result.error || (statusMessage.dataset.error || 'An error occurred. Please try again.');
          statusMessage.className = 'form-status error';
        }
      }
    } catch (error) {
      // Network or other error
      console.error('Form submission error:', error);
      if (statusMessage) {
        statusMessage.textContent = statusMessage.dataset.error || 'An error occurred. Please try again.';
        statusMessage.className = 'form-status error';
      }
    } finally {
      // Re-enable submit button
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitButton.dataset.text || 'Send';
      }
    }
  });
})();
