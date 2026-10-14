'use strict';

// Supplier portal: review and accept job requests, comment, upload before/after photos, mark complete.
(() => {
  const { el, money, fmtStamp, status, details, thread, photos, compressImage } = window.JobsUI;
  // DOM append() would print 'null' for skipped pieces, so drop them first.
  const append = (node, ...kids) => node.append(...kids.filter((k) => k != null && k !== false));
  const $ = (id) => document.getElementById(id);
  let jobs = [];
  let filter = 'requested';

  async function api(path, method = 'GET', body, headers) {
    const res = await fetch(`/api/supplier${path}`, {
      method,
      headers: headers || { 'Content-Type': 'application/json' },
      body: body instanceof Blob ? body : (method === 'GET' ? undefined : JSON.stringify(body || {})),
    });
    if (res.status === 401) { window.location.replace('/supplier'); throw new Error('Signed out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
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
    const [{ supplier, payables }, data] = await Promise.all([api('/me'), api('/jobs')]);
    jobs = data.jobs;
    $('supplier-name').textContent = supplier.company || supplier.name;
    $('greeting').textContent = `Hi ${supplier.name.split(' ')[0]} — your jobs`;
    const count = (s) => jobs.filter((j) => j.status === s).length;
    $('s-new').textContent = String(count('requested'));
    $('s-pending').textContent = String(count('accepted'));
    $('c-requested').textContent = count('requested') || '';
    $('c-accepted').textContent = count('accepted') || '';
    $('s-owed').textContent = money.format((payables?.outstanding_cents || 0) / 100);
    $('s-owed-meta').textContent = payables?.unpaid_jobs ? `${payables.unpaid_jobs} completed job${payables.unpaid_jobs === 1 ? '' : 's'}` : 'nothing outstanding';
    $('s-paid').textContent = money.format((payables?.paid_cents || 0) / 100);
    $('s-paid-meta').textContent = payables?.paid_jobs ? `${payables.paid_jobs} job${payables.paid_jobs === 1 ? '' : 's'}` : '';
    render();
  }

  const reload = () => load().catch((err) => { if (err.message !== 'Signed out') toast(err.message); });

  function render() {
    const list = $('jobs-list');
    const rows = jobs.filter((j) => (filter === 'completed' ? ['completed', 'cancelled'].includes(j.status) : j.status === filter));
    if (filter !== 'completed') rows.sort((a, b) => a.service_date.localeCompare(b.service_date));
    list.replaceChildren(...rows.map(card));
    $('jobs-empty').hidden = rows.length > 0;
    $('jobs-empty').textContent = {
      requested: 'No new job requests right now. We’ll email you when one comes in.',
      accepted: 'No jobs waiting to be completed.',
      completed: 'No completed jobs yet.',
    }[filter];
  }

  function card(j) {
    const [cls, label] = status(j, 'supplier');
    const node = el('article', { class: `job-card status-${j.status}` },
      el('div', { class: 'job-head' },
        el('div', {}, el('h3', {}, `Job ${j.job_number}`), el('span', { class: 'sub' }, `Sent ${fmtStamp(j.created_at)}`)),
        el('span', { class: `badge ${cls}` }, label)),
      details(j, 'supplier'),
      j.instructions ? el('p', { class: 'job-instructions' }, j.instructions) : null);

    if (j.status === 'requested') {
      const accept = el('button', { type: 'button', class: 'btn btn-primary' }, 'Accept Job');
      accept.addEventListener('click', async () => {
        accept.disabled = true;
        try { await api(`/jobs/${j.id}/accept`, 'POST'); toast(`Job ${j.job_number} accepted.`); filter = 'accepted'; selectTab(); await reload(); } catch (err) { toast(err.message); accept.disabled = false; }
      });
      append(node, el('div', { class: 'job-actions' }, accept, el('span', { class: 'sub' }, 'or reply below with a comment or question')));
    }

    if (j.status === 'accepted') append(node, completionForm(j));

    if (j.status === 'completed') {
      append(node, 
        el('p', { class: 'job-done' }, `✓ Completed ${fmtStamp(j.completed_at)} by `, el('strong', {}, j.completed_by)),
        j.completion_notes ? el('p', { class: 'job-instructions' }, j.completion_notes) : null,
        photos(j, (p) => `/api/supplier/photos/${p.id}`),
        el('p', { class: `job-payment ${j.supplier_paid_at ? 'paid' : 'unpaid'}` }, j.supplier_paid_at
          ? `💵 Paid ${fmtStamp(j.supplier_paid_at)}${j.supplier_paid_ref ? ` · Ref: ${j.supplier_paid_ref}` : ''}`
          : `Payment outstanding: ${money.format(j.pay_cents / 100)}`));
    }

    if (j.status !== 'cancelled') {
      append(node, thread(j, 'supplier', async (text) => {
        try { await api(`/jobs/${j.id}/messages`, 'POST', { body: text }); toast('Comment sent to A+ Cleaning.'); await reload(); } catch (err) { toast(err.message); }
      }, { open: j.status !== 'completed' }));
    }
    return node;
  }

  function completionForm(j) {
    const box = el('div', { class: 'job-complete' }, el('h4', { class: 'job-complete-title' }, 'Complete this job'));
    box.append(photos(j, (p) => `/api/supplier/photos/${p.id}`, async (p) => {
      if (!window.confirm('Remove this photo?')) return;
      try { await api(`/jobs/${j.id}/photos/${p.id}`, 'DELETE'); await reload(); } catch (err) { toast(err.message); }
    }));

    const uploader = (kind, label) => {
      const input = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      const btn = el('button', { type: 'button', class: 'btn btn-outline btn-sm' }, `📷 Add ${label} photos`);
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        const files = [...input.files];
        if (!files.length) return;
        btn.disabled = true;
        let done = 0;
        try {
          for (const file of files) {
            btn.textContent = `Uploading ${done + 1} of ${files.length}…`;
            const blob = await compressImage(file);
            await api(`/jobs/${j.id}/photos?kind=${kind}`, 'POST', blob, { 'Content-Type': blob.type || 'image/jpeg' });
            done += 1;
          }
          toast(`${done} ${label.toLowerCase()} photo${done === 1 ? '' : 's'} uploaded.`);
        } catch (err) {
          toast(err.message);
        }
        await reload();
      });
      return el('span', {}, btn, input);
    };
    box.append(el('div', { class: 'job-upload' }, uploader('before', 'Before'), uploader('after', 'After')));

    const name = el('input', { type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'First and last name', id: `cb-${j.id}` });
    const notes = el('textarea', { rows: '2', maxlength: '2000', placeholder: 'Anything A+ should know? (optional)', id: `cn-${j.id}` });
    const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Mark Job Complete');
    const form = el('form', { class: 'job-complete-form' },
      el('div', { class: 'field' }, el('label', { for: `cb-${j.id}` }, 'Employee who completed the job (full name)'), name),
      el('div', { class: 'field' }, el('label', { for: `cn-${j.id}` }, 'Notes ', el('span', { class: 'optional' }, '(optional)')), notes),
      submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const before = j.photos.filter((p) => p.kind === 'before').length;
      const after = j.photos.filter((p) => p.kind === 'after').length;
      if (!before || !after) { toast('Upload at least one before photo and one after photo first.'); return; }
      if (name.value.trim().split(/\s+/).length < 2) { toast('Enter the employee’s first and last name.'); name.focus(); return; }
      submit.disabled = true;
      try {
        await api(`/jobs/${j.id}/complete`, 'POST', { completedBy: name.value, notes: notes.value });
        toast(`Job ${j.job_number} marked complete. Thank you!`);
        filter = 'completed'; selectTab();
        await reload();
      } catch (err) { toast(err.message); submit.disabled = false; }
    });
    box.append(form);
    return box;
  }

  function selectTab() {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.filter === filter)));
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { filter = t.dataset.filter; selectTab(); render(); }));
    $('logout-btn').addEventListener('click', async () => {
      try { await api('/logout', 'POST'); } finally { window.location.assign('/supplier'); }
    });
    load().then(() => {
      // Open on whichever list needs attention.
      if (!jobs.some((j) => j.status === 'requested') && jobs.some((j) => j.status === 'accepted')) { filter = 'accepted'; selectTab(); render(); }
    }).catch((err) => { if (err.message !== 'Signed out') toast(err.message); });
  });
})();
