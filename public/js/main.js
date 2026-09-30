'use strict';

document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (toggle && menu) {
    const setOpen = (open) => {
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  }

  // Header shadow on scroll
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Reveal on scroll
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  // Plan buttons pre-select the plan in the booking form
  const planSelect = document.getElementById('inq-plan');
  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => { if (planSelect) planSelect.value = btn.dataset.plan; });
  });

  // Booking / quote form
  const form = document.getElementById('inquiry-form');
  if (form) {
    const alertBox = form.querySelector('.alert');
    const submit = form.querySelector('button[type="submit"]');
    const show = (type, message) => {
      alertBox.className = `alert alert-${type}`;
      alertBox.textContent = message;
      alertBox.hidden = false;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (!data.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
        show('error', 'Please include your name and a valid email address.');
        return;
      }
      submit.disabled = true;
      try {
        const res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Something went wrong.');
        form.reset();
        show('success', 'Thanks! Your request is in — we’ll be in touch shortly with a quote.');
      } catch (err) {
        show('error', `${err.message} You can also email info@aplus-cleaning-solutions.com.`);
      } finally {
        submit.disabled = false;
      }
    });
  }
});
