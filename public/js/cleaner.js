'use strict';

// Cleaner page (/c/:token): one job only, no login. Upload before/after photos, add your name, submit for review.
(() => {
  const { el, whenText, sizeText, photos, compressImage } = window.JobsUI;
  const $ = (id) => document.getElementById(id);
  const T = (s, v) => (window.I18N ? window.I18N.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const base = `/api/cleaner/${encodeURIComponent(token)}`;
  let job;

  async function api(path, method = 'GET', body, headers) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers || { 'Content-Type': 'application/json' },
      body: body instanceof Blob ? body : (method === 'GET' ? undefined : JSON.stringify(body || {})),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'Something went wrong.'); err.status = res.status; throw err; }
    return data;
  }

  let toastTimer;
  function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function load() {
    try {
      ({ job } = await api(''));
      render();
    } catch (err) {
      $('job').replaceChildren(el('div', { class: 'panel cleaner-expired' },
        el('h1', {}, err.status === 404 ? 'Link not available' : 'Couldn’t load the job'),
        el('p', { class: 'muted' }, err.message)));
    } finally {
      $('loading').hidden = true;
    }
  }

  const photoSrc = (p) => `${base}/photos/${p.id}`;
  const count = (kind) => job.photos.filter((p) => p.kind === kind).length;

  function render() {
    const facts = el('dl', { class: 'job-facts' },
      el('div', {}, el('dt', {}, 'Address'), el('dd', {}, job.address, job.unit ? `, Unit ${job.unit}` : '')),
      el('div', {}, el('dt', {}, 'When'), el('dd', {}, whenText(job))),
      sizeText(job) || job.service ? el('div', {}, el('dt', {}, 'Unit'), el('dd', {}, [sizeText(job), job.service].filter(Boolean).join(' · '))) : null);
    const card = el('article', { class: 'job-card' },
      el('div', { class: 'job-head' },
        el('div', {}, el('h1', { class: 'cleaner-title' }, T('Job {number}', { number: job.job_number })), el('span', { class: 'sub' }, T('For {company}', { company: job.company }))),
        job.submitted_at ? el('span', { class: 'badge badge-completed' }, 'Submitted') : el('span', { class: 'badge badge-pending' }, 'To do')),
      facts,
      job.instructions ? el('p', { class: 'job-instructions' }, job.instructions) : null);

    if (job.submitted_at) {
      card.append(
        el('p', { class: 'job-done' }, '✓ Thank you, ', el('strong', {}, job.submitted_by), ' — your photos were sent for review. You can close this page.'),
        photos(job, photoSrc));
    } else {
      card.append(uploadSection());
    }
    $('job').replaceChildren(card);
  }

  function uploadSection() {
    const box = el('div', { class: 'job-complete' },
      el('h2', { class: 'job-complete-title' }, 'Step 1 · Take before & after photos'),
      el('p', { class: 'sub' }, 'Before photos when you arrive, after photos when you finish. At least one of each.'));
    box.append(photos(job, photoSrc, async (p) => {
      if (!window.confirm('Remove this photo?')) return;
      try { await api(`/photos/${p.id}`, 'DELETE'); await reload(); } catch (err) { toast(err.message); }
    }));

    const uploader = (kind, label) => {
      const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      const btn = el('button', { type: 'button', class: 'btn btn-outline' }, `📷 Add ${label} photos`);
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const files = [...input.files];
        if (!files.length) return;
        btn.disabled = true;
        let done = 0;
        try {
          for (const file of files) {
            btn.textContent = T('Uploading {i} of {n}…', { i: done + 1, n: files.length });
            const blob = await compressImage(file);
            await api(`/photos?kind=${kind}`, 'POST', blob, { 'Content-Type': blob.type || 'image/jpeg' });
            done += 1;
          }
          toast(T(done === 1 ? '{n} photo uploaded.' : '{n} photos uploaded.', { n: done }));
        } catch (err) {
          toast(err.message);
        }
        await reload();
      });
      return el('span', {}, btn, input);
    };
    box.append(el('div', { class: 'job-upload' }, uploader('before', 'Before'), uploader('after', 'After')));

    const name = el('input', { type: 'text', id: 'cleaner-name', maxlength: '120', autocomplete: 'name', placeholder: 'First and last name', required: true });
    try { name.value = localStorage.getItem('aplus_cleaner_name') || ''; } catch { /* storage blocked */ }
    const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Submit Job');
    const form = el('form', { class: 'job-complete-form' },
      el('h2', { class: 'job-complete-title' }, 'Step 2 · Your name & submit'),
      el('div', { class: 'field' }, el('label', { for: 'cleaner-name' }, 'Your full name'), name),
      submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!count('before') || !count('after')) { toast('Add at least one before photo and one after photo first.'); return; }
      if (name.value.trim().split(/\s+/).length < 2) { toast('Enter your first and last name.'); name.focus(); return; }
      submit.disabled = true;
      try {
        await api('/submit', 'POST', { name: name.value });
        try { localStorage.setItem('aplus_cleaner_name', name.value.trim()); } catch { /* storage blocked */ }
        toast('Submitted — thank you!');
        await reload();
      } catch (err) { toast(err.message); submit.disabled = false; }
    });
    box.append(form);
    return box;
  }

  const reload = () => load();

  document.addEventListener('DOMContentLoaded', load);
})();
