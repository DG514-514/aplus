'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const alertBox = form.querySelector('.alert');
  const submit = form.querySelector('button[type="submit"]');
  const password = document.getElementById('password');
  const revealBtn = form.querySelector('.reveal-pw');

  revealBtn.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    revealBtn.textContent = show ? 'Hide' : 'Show';
    revealBtn.setAttribute('aria-pressed', String(show));
    revealBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    const email = form.email.value.trim();
    if (!email || !password.value) {
      alertBox.textContent = 'Enter your email and password.';
      alertBox.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const res = await fetch(form.dataset.endpoint || '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: password.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Unable to sign in right now.');
      window.location.assign(form.dataset.redirect || '/portal');
    } catch (err) {
      alertBox.textContent = err.message;
      alertBox.hidden = false;
      password.value = '';
      password.focus();
      submit.disabled = false;
      submit.textContent = 'Sign In';
    }
  });
});
