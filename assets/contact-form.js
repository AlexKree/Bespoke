// Contact form handler
(function() {
  const contactForm = document.getElementById('contact-form');
  if (!contactForm) return;

  const submitBtn = contactForm.querySelector('button[type="submit"]');
  const statusMessage = document.getElementById('form-status');

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Disable submit button and show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = submitBtn.dataset.loading || 'Sending...';
    
    if (statusMessage) {
      statusMessage.textContent = '';
      statusMessage.className = '';
    }

    // Collect form data
    const formData = {
      name: contactForm.querySelector('[name="name"]').value,
      email: contactForm.querySelector('[name="email"]').value,
      phone: contactForm.querySelector('[name="phone"]').value,
      budget: contactForm.querySelector('[name="budget"]').value,
      vehicle: contactForm.querySelector('[name="vehicle"]').value,
      message: contactForm.querySelector('[name="message"]').value
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
          statusMessage.textContent = result.message || submitBtn.dataset.success || 'Message sent successfully!';
          statusMessage.className = 'form-status success';
        }
        
        // Reset form
        contactForm.reset();
      } else {
        // Error from server
        if (statusMessage) {
          statusMessage.textContent = result.error || submitBtn.dataset.error || 'An error occurred. Please try again.';
          statusMessage.className = 'form-status error';
        }
      }
    } catch (error) {
      // Network error
      console.error('Form submission error:', error);
      if (statusMessage) {
        statusMessage.textContent = submitBtn.dataset.error || 'Network error. Please try again.';
        statusMessage.className = 'form-status error';
      }
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.text || 'Send';
    }
  });
})();
