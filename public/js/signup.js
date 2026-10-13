'use strict';

// Website sign-up: the account is created as "pending" until the owner approves it.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signup-form');
  const alertBox = form.querySelector('.alert');
  const submit = form.querySelector('button[type="submit"]');
  const password = document.getElementById('su-password');
  const revealBtn = form.querySelector('.reveal-pw');

  revealBtn.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    revealBtn.textContent = show ? 'Hide' : 'Show';
    revealBtn.setAttribute('aria-pressed', String(show));
    revealBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  const showError = (message, field) => {
    alertBox.textContent = message;
    alertBox.hidden = false;
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (field) field.focus({ preventScroll: true });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(data)) data[key] = String(data[key]).trim();
    data.password = password.value;

    if (data.name.length < 2) return showError('Enter your full name.', form.name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return showError('Enter a valid email address.', form.email);
    if (data.phone.replace(/\D/g, '').length < 7) return showError('Enter a phone number we can reach you at.', form.phone);
    if (!data.residence) return showError('Enter your residence or street address.', form.residence);
    if (!data.bedrooms) return showError('Choose the number of bedrooms.', form.bedrooms);
    if (!data.bathrooms) return showError('Choose the number of bathrooms.', form.bathrooms);
    if (data.password.length < 8) return showError('Choose a password of at least 8 characters.', password);

    submit.disabled = true;
    submit.textContent = 'Creating account…';
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      document.getElementById('su-done-email').textContent = data.email;
      document.getElementById('signup-step').hidden = true;
      document.getElementById('signup-done').hidden = false;
      window.scrollTo({ top: 0 });
    } catch (err) {
      showError(err.message);
      submit.disabled = false;
      submit.textContent = 'Create Account';
    }
  });
});
