'use strict';

// Website sign-up: the client signs the Terms & Conditions as part of the form, the account is
// created straight away and they land in their portal, signed in.
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

  const T = (s, v) => (window.I18N ? window.I18N.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
  const el = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'class') node.className = v; else node.setAttribute(k, v); });
    kids.forEach((k) => { if (k != null) node.append(k); });
    return node;
  };

  // Load and show the current Terms & Conditions; the version is sent with the signature.
  let termsVersion = null;
  const termsBox = document.getElementById('su-terms');
  fetch('/api/terms').then((r) => r.json()).then((t) => {
    termsVersion = t.version;
    const parts = [el('p', { class: 'muted' }, T('{company} · Terms & Conditions of Service · Version {version}', t))];
    if (window.I18N && window.I18N.lang === 'es') {
      parts.push(el('p', { class: 'alert alert-info' }, T('Courtesy translation. The English version of these Terms & Conditions is the one that applies and prevails if there is any difference.')));
    }
    for (const section of t.sections) {
      parts.push(el('section', {}, el('h3', {}, section.heading),
        ...section.blocks.map((b) => (b.type === 'list' ? el('ul', {}, ...b.items.map((i) => el('li', {}, i))) : el('p', {}, b.text)))));
    }
    termsBox.replaceChildren(...parts);
  }).catch(() => {
    termsBox.replaceChildren(el('p', {}, T('We couldn’t load the Terms & Conditions. Please refresh the page.')));
  });

  // Suggest the full name as the signature once it's typed.
  const signName = document.getElementById('su-sign');
  form.name.addEventListener('change', () => { if (!signName.value.trim()) signName.value = form.name.value.trim().replace(/\s+/g, ' '); });

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
    if (!termsVersion) return showError('We couldn’t load the Terms & Conditions. Please refresh the page.');
    if ((data.signedName || '').length < 2) return showError('Type your full name to sign the Terms & Conditions.', signName);
    const agree = document.getElementById('su-agree');
    if (!agree.checked) return showError('Tick the box to confirm you agree to the Terms & Conditions.', agree);
    data.agree = true;
    data.termsVersion = termsVersion;

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
      // Account created and signed in: straight to the portal.
      window.location.assign(body.redirect || '/portal');
    } catch (err) {
      showError(T(err.message));
      submit.disabled = false;
      submit.textContent = 'Sign & Create Account';
    }
  });
});
