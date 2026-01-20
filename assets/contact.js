// Contact form handler for SMTP email sending via Netlify Functions
(function() {
  const form = document.getElementById('contactForm');
  
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;
    
    // Disable the button and show loading state
    submitButton.disabled = true;
    submitButton.textContent = submitButton.dataset.loading || 'Sending...';
    
    // Get form data
    const formData = {
      name: form.querySelector('[name="name"]').value,
      email: form.querySelector('[name="email"]').value,
      phone: form.querySelector('[name="phone"]').value,
      budget: form.querySelector('[name="budget"]').value,
      vehicle: form.querySelector('[name="vehicle"]').value,
      message: form.querySelector('[name="message"]').value
    };
    
    try {
      const response = await fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      const result = await response.json();
      
      if (response.ok) {
        // Success - show success message
        const successMessage = form.dataset.success || 'Message sent successfully!';
        showMessage(form, successMessage, 'success');
        form.reset();
      } else {
        // Error - show error message
        const errorMessage = form.dataset.error || 'Error sending message. Please try again.';
        showMessage(form, errorMessage, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = form.dataset.error || 'Error sending message. Please try again.';
      showMessage(form, errorMessage, 'error');
    } finally {
      // Re-enable the button
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  });
  
  function showMessage(form, message, type) {
    // Remove any existing messages
    const existingMessage = form.parentElement.querySelector('.form-message');
    if (existingMessage) {
      existingMessage.remove();
    }
    
    // Create and insert new message
    const messageDiv = document.createElement('div');
    messageDiv.className = `form-message form-message-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
      padding: 12px 16px;
      margin-top: 16px;
      border-radius: 4px;
      font-size: 14px;
      ${type === 'success' ? 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;' : 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;'}
    `;
    
    form.insertAdjacentElement('afterend', messageDiv);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      messageDiv.style.opacity = '0';
      messageDiv.style.transition = 'opacity 0.5s';
      setTimeout(() => messageDiv.remove(), 500);
    }, 5000);
  }
})();
