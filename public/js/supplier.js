'use strict';

// Supplier portal: review and accept job requests, comment, upload before/after photos, mark complete.
(() => {
  const { el, money, fmtStamp, fmtDate, status, details, thread, photos, compressImage, calendar, calendarSync, todayIso } = window.JobsUI;
  // DOM append() would print 'null' for skipped pieces, so drop them first.
  const append = (node, ...kids) => node.append(...kids.filter((k) => k != null && k !== false));
  const $ = (id) => document.getElementById(id);
  let jobs = [];
  let filter = 'requested';
  const VIEW_KEY = 'aplus_sup_view';
  let view = (() => { try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } })();
  let calDay = todayIso();
  let calMonth = calDay.slice(0, 7);

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
    $('list-view').hidden = view !== 'list';
    $('calendar-view').hidden = view !== 'calendar';
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view === 'calendar') { renderCalendar(); return; }
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

  // Calendar view: month grid (agenda on phones); tapping a day shows that day's job cards below.
  function renderCalendar() {
    $('cal').replaceChildren(calendar({
      jobs, viewer: 'supplier', month: calMonth, selected: calDay,
      onMonth: (ym) => { calMonth = ym; render(); },
      onDay: (iso) => {
        calDay = iso;
        calMonth = iso.slice(0, 7);
        render();
        $('cal-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }));
    const dayJobs = jobs.filter((j) => j.service_date === calDay).sort((a, b) => (a.time_start || '99').localeCompare(b.time_start || '99'));
    const title = `${calDay === todayIso() ? 'Today · ' : ''}${fmtDate(calDay, { weekday: 'long', month: 'long', day: 'numeric' })}`;
    $('cal-day').replaceChildren(
      el('h3', { class: 'cal-day-title' }, title, el('span', { class: 'sub' }, ` · ${dayJobs.length || 'no'} job${dayJobs.length === 1 ? '' : 's'}`)),
      dayJobs.length ? el('div', { class: 'jobs-list' }, ...dayJobs.map(card)) : el('p', { class: 'empty' }, 'No jobs on this day.'));
    if (!$('cal-sync').childElementCount) {
      $('cal-sync').append(calendarSync({
        title: 'Your jobs in your phone calendar',
        intro: 'See your A+ jobs next to your own appointments in Google Calendar, iPhone or Outlook. They update automatically.',
        fetchLinks: (reset) => api('/calendar-link', 'POST', { reset }),
        toast,
      }));
    }
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

    if (j.status === 'accepted') append(node, ...(j.cleaner_submitted_at ? [reviewBox(j)] : [cleanerLinkBox(j), completionForm(j)]));

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

  // Private one-job link for the cleaner: they upload photos and their name without a login.
  function cleanerLinkBox(j) {
    const box = el('div', { class: 'job-link' }, el('h4', {}, '🔗 Cleaner link'));
    const url = j.cleaner_token ? `${window.location.origin}/c/${j.cleaner_token}` : null;
    const act = async (path, method, done) => {
      try { const data = await api(path, method); if (done) await done(data); await reload(); } catch (err) { toast(err.message); }
    };
    const copy = async (text) => {
      try { await navigator.clipboard.writeText(text); toast('Link copied — send it to your cleaner.'); } catch { window.prompt('Copy this link:', text); }
    };
    if (!url) {
      append(box,
        el('p', { class: 'sub' }, 'Send your cleaner a private link for this job only. They add before & after photos and their name — no login, and they can’t see other jobs or pay.'),
        el('div', { class: 'job-link-actions' }, el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => act(`/jobs/${j.id}/cleaner-link`, 'POST', (d) => copy(d.url)) }, 'Get Cleaner Link')));
      return box;
    }
    const message = `A+ Cleaning job ${j.job_number}: please upload before & after photos here: ${url}`;
    append(box,
      el('p', { class: 'sub' }, 'Works for this job only, until it’s completed. You’ll get an email when photos are submitted.'),
      el('div', { class: 'job-link-url' }, url),
      el('div', { class: 'job-link-actions' },
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => copy(url) }, 'Copy'),
        navigator.share ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => navigator.share({ title: `Job ${j.job_number}`, text: message }).catch(() => {}) }, 'Share') : null,
        el('a', { class: 'btn btn-outline btn-sm', href: `sms:?&body=${encodeURIComponent(message)}` }, 'Text'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { if (window.confirm('Make a new link? The old one stops working.')) act(`/jobs/${j.id}/cleaner-link?new=1`, 'POST', (d) => copy(d.url)); } }, 'New Link'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { if (window.confirm('Turn off this link?')) act(`/jobs/${j.id}/cleaner-link`, 'DELETE', () => toast('Link turned off.')); } }, 'Turn Off')));
    return box;
  }

  // The cleaner submitted photos: approve to complete the job, or send it back for changes.
  function reviewBox(j) {
    const approve = el('button', { type: 'button', class: 'btn btn-primary' }, 'Approve & Complete');
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        await api(`/jobs/${j.id}/complete`, 'POST', { completedBy: j.cleaner_signed_by, notes: '' });
        toast(`Job ${j.job_number} approved and marked complete.`);
        filter = 'completed'; selectTab();
        await reload();
      } catch (err) { toast(err.message); approve.disabled = false; }
    });
    const back = el('button', { type: 'button', class: 'btn btn-outline' }, 'Send Back to Cleaner');
    back.addEventListener('click', async () => {
      if (!window.confirm('Send back? The cleaner can change photos and submit again with the same link.')) return;
      try { await api(`/jobs/${j.id}/send-back`, 'POST'); toast('Sent back — the cleaner’s link is open again.'); await reload(); } catch (err) { toast(err.message); }
    });
    return el('div', { class: 'job-review' },
      el('h4', {}, 'Ready for review'),
      el('p', { class: 'sub' }, el('strong', {}, j.cleaner_signed_by), ` submitted photos ${fmtStamp(j.cleaner_submitted_at)} — check them, then approve.`),
      photos(j, (p) => `/api/supplier/photos/${p.id}`),
      el('div', { class: 'job-link-actions' }, approve, back));
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
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      view = b.dataset.view;
      try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage blocked */ }
      render();
    }));
    $('logout-btn').addEventListener('click', async () => {
      try { await api('/logout', 'POST'); } finally { window.location.assign('/supplier'); }
    });
    load().then(() => {
      // Open on whichever list needs attention.
      if (!jobs.some((j) => j.status === 'requested') && jobs.some((j) => j.status === 'accepted')) { filter = 'accepted'; selectTab(); render(); }
    }).catch((err) => { if (err.message !== 'Signed out') toast(err.message); });
  });
})();
