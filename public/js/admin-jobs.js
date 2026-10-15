'use strict';

// Owner dashboard → Jobs: send job requests to suppliers, follow replies, see photos, track supplier payments.
// Uses admin.js globals: $, api, toast, formError, state, SERVICES.
(() => {
  const { el, money, fmtStamp, fmtDate, status, details, thread, photos, calendar, calendarSync, todayIso, shortTime } = window.JobsUI;
  // DOM append() would print 'null' for skipped pieces, so drop them first.
  const append = (node, ...kids) => node.append(...kids.filter((k) => k != null && k !== false));
  const jobsState = { jobs: [], payables: [], filter: 'open', editing: null };
  const VIEW_KEY = 'aplus_admin_jobview';
  const cal = {
    view: (() => { try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } })(),
    day: todayIso(), month: todayIso().slice(0, 7), supplier: '',
  };

  async function loadJobs() {
    const data = await api('/jobs');
    jobsState.jobs = data.jobs;
    jobsState.payables = data.payables;
    const attention = data.jobs.filter((j) => j.awaiting_owner).length;
    const unpaid = data.jobs.filter((j) => j.status === 'completed' && !j.supplier_paid_at).length;
    $('jf-attention').textContent = attention || '';
    $('jf-unpaid').textContent = unpaid || '';
    renderPayables();
    renderJobs();
  }
  const reload = () => loadJobs().catch((err) => { if (err.message !== 'Signed out') toast(err.message); });

  /* ---------- Supplier payments ---------- */

  function renderPayables() {
    const list = $('payables');
    const rows = jobsState.payables;
    $('payables-empty').hidden = rows.length > 0;
    const total = rows.reduce((sum, p) => sum + p.outstanding_cents, 0);
    $('payables-total').textContent = rows.length ? `Total outstanding: ${money.format(total / 100)}` : '';
    list.replaceChildren(...rows.map((p) => {
      const payAll = p.unpaid_jobs ? el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => payAllFor(p) }, 'Mark All Paid') : el('span', { class: 'sub' }, 'All paid ✓');
      return el('div', { class: 'payable' },
        el('div', {}, el('strong', {}, p.cleaner_company ? `${p.cleaner_name} (${p.cleaner_company})` : p.cleaner_name),
          el('span', { class: 'sub' }, `${p.unpaid_jobs} unpaid job${p.unpaid_jobs === 1 ? '' : 's'} · ${money.format(p.paid_cents / 100)} paid across ${p.paid_jobs} job${p.paid_jobs === 1 ? '' : 's'}`)),
        el('span', { class: `owed${p.outstanding_cents ? '' : ' zero'}` }, money.format(p.outstanding_cents / 100)),
        payAll);
    }));
  }

  async function payAllFor(p) {
    const ref = window.prompt(`Mark ${p.unpaid_jobs} job${p.unpaid_jobs === 1 ? '' : 's'} (${money.format(p.outstanding_cents / 100)}) as paid to ${p.cleaner_name}?\n\nPayment reference (optional, e.g. e-Transfer # or cheque #):`, '');
    if (ref == null) return;
    try { await api('/jobs/pay-all', 'POST', { cleanerId: p.cleaner_id, ref }); toast(`Marked paid to ${p.cleaner_name}.`); await reload(); } catch (err) { toast(err.message); }
  }

  /* ---------- Job form ---------- */

  const NO_SERVICE = '';
  function fillSelects() {
    const cleaners = $('j-cleaner');
    const keep = cleaners.value;
    cleaners.replaceChildren(el('option', { value: '' }, 'Choose a supplier…'),
      ...state.cleaners.filter((c) => c.active || String(c.id) === keep)
        .map((c) => el('option', { value: String(c.id) }, `${c.name}${c.company ? ` (${c.company})` : ''}${c.portal ? '' : ' — no portal login'}`)));
    cleaners.value = keep;

    const clients = $('j-client');
    const keepClient = clients.value;
    clients.replaceChildren(el('option', { value: '' }, '— None / enter address below —'),
      ...state.clients.filter((c) => c.status !== 'pending').map((c) => el('option', { value: String(c.id) }, `${c.name}${c.residence ? ` — ${c.residence}` : ''}`)));
    clients.value = keepClient;

    const service = $('j-service');
    if (!service.options.length) {
      service.replaceChildren(el('option', { value: NO_SERVICE }, 'Select…'), ...SERVICES.map((s) => el('option', { value: s.name }, s.name)), el('option', { value: 'Other' }, 'Other (describe in instructions)'));
    }
    updateHints();
  }

  function selectedCleaner() { return state.cleaners.find((c) => String(c.id) === $('j-cleaner').value); }

  function updateHints() {
    const c = selectedCleaner();
    $('j-cleaner-hint').textContent = c && !c.portal ? 'This supplier has no portal login yet — create one in Suppliers / Cleaners so they can see this job.' : '';
    const std = SERVICES.find((s) => s.name === $('j-service').value);
    const pay = Number($('j-pay').value);
    $('j-pay-hint').textContent = std && pay ? `You charge ${money.format(std.price)} · margin ${money.format(std.price - pay)}` : '';
  }

  // Pre-fill pay from the supplier's listed cost for the chosen service.
  function suggestPay() {
    const c = selectedCleaner();
    const svc = c?.services.find((s) => s.service === $('j-service').value && s.unit === 'clean');
    if (svc) $('j-pay').value = (svc.cost_cents / 100).toFixed(2);
    updateHints();
  }

  function onClientChange() {
    const c = state.clients.find((x) => String(x.id) === $('j-client').value);
    if (!c) return;
    $('j-address').value = c.residence || '';
    $('j-unit').value = c.room || '';
    if (c.bedrooms) $('j-bedrooms').value = c.bedrooms;
    if (c.bathrooms) $('j-bathrooms').value = c.bathrooms;
    const match = SERVICES.find((s) => s.bedrooms && s.bedrooms === c.bedrooms && s.bathrooms === c.bathrooms)
      || (c.bedrooms === 'Studio' ? SERVICES.find((s) => s.id === 'studio') : null);
    if (match) { $('j-service').value = match.name; suggestPay(); }
  }

  function resetForm() {
    const form = $('job-form');
    form.reset();
    formError(form, '');
    jobsState.editing = null;
    $('job-form-title').textContent = 'Send a job request to a supplier';
    $('job-submit').textContent = 'Send Job Request';
    $('job-cancel-edit').hidden = true;
    updateHints();
  }

  function editJob(j) {
    jobsState.editing = j;
    fillSelects();
    const f = $('job-form');
    f.cleanerId.value = String(j.cleaner_id);
    f.clientId.value = j.client_id ? String(j.client_id) : '';
    f.address.value = j.address;
    f.unit.value = j.unit || '';
    f.bedrooms.value = j.bedrooms || '';
    f.bathrooms.value = j.bathrooms || '';
    f.service.value = j.service || '';
    f.pay.value = (j.pay_cents / 100).toFixed(2);
    f.serviceDate.value = j.service_date;
    f.timeStart.value = j.time_start || '';
    f.timeEnd.value = j.time_end || '';
    f.instructions.value = j.instructions || '';
    $('job-form-title').textContent = `Edit job ${j.job_number}`;
    $('job-submit').textContent = 'Save Changes';
    $('job-cancel-edit').hidden = false;
    updateHints();
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitJob(e) {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form));
    if (!data.cleanerId) return formError(form, 'Choose a supplier.');
    if (!data.address.trim()) return formError(form, 'Add the address of the job.');
    if (!data.serviceDate) return formError(form, 'Choose the requested date.');
    if (data.pay === '') return formError(form, 'Enter what you’ll pay the supplier for this job.');
    if (data.clientId) data.clientName = state.clients.find((c) => String(c.id) === data.clientId)?.name;
    const btn = $('job-submit');
    btn.disabled = true;
    try {
      if (jobsState.editing) {
        const { reassigned } = await api(`/jobs/${jobsState.editing.id}`, 'PATCH', data);
        toast(reassigned ? 'Job re-assigned and sent to the new supplier.' : 'Job updated — the supplier has been notified.');
      } else {
        const { job_number } = await api('/jobs', 'POST', data);
        toast(`Job ${job_number} sent to the supplier.`);
      }
      resetForm();
      jobsState.filter = 'open';
      selectFilter();
      await reload();
    } catch (err) {
      formError(form, err.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- Job list ---------- */

  const FILTERS = {
    open: (j) => ['requested', 'accepted'].includes(j.status),
    attention: (j) => j.awaiting_owner,
    unpaid: (j) => j.status === 'completed' && !j.supplier_paid_at,
    paid: (j) => j.status === 'completed' && j.supplier_paid_at,
    all: () => true,
  };

  function renderJobs() {
    $('admin-list-view').hidden = cal.view !== 'list';
    $('admin-calendar-view').hidden = cal.view !== 'calendar';
    document.querySelectorAll('[data-jobview]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jobview === cal.view)));
    if (cal.view === 'calendar') { renderCalendar(); return; }
    const q = $('job-search').value.trim().toLowerCase();
    const rows = jobsState.jobs.filter(FILTERS[jobsState.filter])
      .filter((j) => !q || [j.job_number, j.address, j.unit, j.client_name, j.cleaner_name, j.cleaner_company, j.completed_by, j.cleaner_signed_by].join(' ').toLowerCase().includes(q));
    if (jobsState.filter === 'open') rows.sort((a, b) => a.service_date.localeCompare(b.service_date));
    $('admin-jobs-list').replaceChildren(...rows.map(card));
    $('admin-jobs-empty').hidden = rows.length > 0;
  }

  /* ---------- Calendar ---------- */

  function renderCalendar() {
    // Supplier filter: everyone who has a job, plus active suppliers.
    const sel = $('cal-supplier');
    const names = new Map();
    for (const c of state.cleaners || []) names.set(String(c.id), c.company ? `${c.name} (${c.company})` : c.name);
    for (const j of jobsState.jobs) if (!names.has(String(j.cleaner_id))) names.set(String(j.cleaner_id), j.cleaner_company ? `${j.cleaner_name} (${j.cleaner_company})` : j.cleaner_name);
    sel.replaceChildren(el('option', { value: '' }, 'All suppliers'), ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => el('option', { value: id }, name)));
    sel.value = names.has(cal.supplier) ? cal.supplier : '';

    const jobs = jobsState.jobs.filter((j) => !sel.value || String(j.cleaner_id) === sel.value);
    // Chips show the supplier too, so double bookings stand out.
    const who = (j) => j.cleaner_name.split(' ')[0];
    $('admin-cal').replaceChildren(calendar({
      jobs, viewer: 'owner', month: cal.month, selected: cal.day,
      label: (j) => [j.time_start ? shortTime(j.time_start) : null, sel.value ? null : who(j), j.address.split(',')[0]].filter(Boolean).join(' · '),
      onMonth: (ym) => { cal.month = ym; renderJobs(); },
      onDay: (iso) => {
        cal.day = iso;
        cal.month = iso.slice(0, 7);
        renderJobs();
        $('admin-cal-day').scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }));

    const dayJobs = jobs.filter((j) => j.service_date === cal.day).sort((a, b) => (a.time_start || '99').localeCompare(b.time_start || '99'));
    const newJob = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => newJobOn(cal.day) }, '＋ New Job on This Date');
    $('admin-cal-day').replaceChildren(
      el('div', { class: 'cal-day-head' },
        el('h3', { class: 'cal-day-title' }, `${cal.day === todayIso() ? 'Today · ' : ''}${fmtDate(cal.day, { weekday: 'long', month: 'long', day: 'numeric' })}`,
          el('span', { class: 'sub' }, ` · ${dayJobs.length || 'no'} job${dayJobs.length === 1 ? '' : 's'}`)),
        cal.day >= todayIso() ? newJob : null),
      dayJobs.length ? el('div', { class: 'jobs-list' }, ...dayJobs.map(card)) : el('p', { class: 'empty' }, 'No jobs on this day.'));

    if (!$('admin-cal-sync').childElementCount) {
      $('admin-cal-sync').append(calendarSync({
        title: 'All jobs in your phone calendar',
        intro: 'Every supplier job (with the supplier’s name) in your Google Calendar, iPhone or Outlook, kept up to date automatically.',
        fetchLinks: (reset) => api('/jobs/calendar-link', 'POST', { reset }),
        toast,
      }));
    }
  }

  // Start a new job request already set to the chosen date (and supplier, if one is filtered).
  function newJobOn(iso) {
    resetForm();
    $('j-date').value = iso;
    if (cal.supplier) { $('j-cleaner').value = cal.supplier; suggestPay(); }
    $('job-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('j-cleaner').focus({ preventScroll: true });
  }

  function card(j) {
    const [cls, label] = status(j, 'owner');
    const actions = el('div', { class: 'job-owner-actions' });
    if (['requested', 'accepted'].includes(j.status)) {
      actions.append(
        el('button', { type: 'button', class: 'link-btn', onclick: () => editJob(j) }, 'Edit / Re-assign'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => cancelJob(j) }, 'Cancel Job'));
    }
    if (j.status === 'completed') {
      actions.append(j.supplier_paid_at
        ? el('button', { type: 'button', class: 'link-btn', onclick: () => setPaid(j, false) }, 'Mark Unpaid')
        : el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => setPaid(j, true) }, `Mark Paid (${money.format(j.pay_cents / 100)})`));
    }
    if (j.status === 'cancelled') actions.append(el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteJob(j) }, 'Delete'));

    const node = el('article', { class: `job-card status-${j.status}` },
      el('div', { class: 'job-head' },
        el('div', {}, el('h3', {}, `Job ${j.job_number}`), el('span', { class: 'sub' }, `Created ${fmtStamp(j.created_at)}${j.accepted_at ? ` · accepted ${fmtStamp(j.accepted_at)}` : ''}`)),
        el('span', { class: `badge ${cls}` }, label)),
      details(j, 'owner'),
      j.instructions ? el('p', { class: 'job-instructions' }, j.instructions) : null);

    if (j.status === 'accepted' && (j.cleaner_submitted_at || j.cleaner_token)) {
      append(node, el('p', { class: 'job-done' }, ...(j.cleaner_submitted_at
        ? ['📷 Cleaner ', el('strong', {}, j.cleaner_signed_by), ` submitted photos ${fmtStamp(j.cleaner_submitted_at)} — waiting for the supplier to approve.`]
        : ['🔗 Supplier sent a cleaner photo link — photos appear below as they’re uploaded.'])));
    }
    if (j.status === 'completed') {
      append(node, 
        el('p', { class: 'job-done' }, `✓ Completed ${fmtStamp(j.completed_at)} by `, el('strong', {}, j.completed_by)),
        j.completion_notes ? el('p', { class: 'job-instructions' }, j.completion_notes) : null,
        el('p', { class: `job-payment ${j.supplier_paid_at ? 'paid' : 'unpaid'}` }, j.supplier_paid_at
          ? `💵 Paid to supplier ${fmtStamp(j.supplier_paid_at)}${j.supplier_paid_ref ? ` · Ref: ${j.supplier_paid_ref}` : ''}`
          : `Outstanding to supplier: ${money.format(j.pay_cents / 100)}`));
    }
    if (j.photos.length || j.status === 'completed') append(node, photos(j, (p) => `/api/admin/jobs/photos/${p.id}`));
    if (j.status !== 'cancelled') {
      append(node, thread(j, 'owner', async (text) => {
        try { await api(`/jobs/${j.id}/messages`, 'POST', { body: text }); toast('Reply sent to the supplier.'); await reload(); } catch (err) { toast(err.message); }
      }));
    }
    if (actions.children.length) append(node, actions);
    return node;
  }

  async function cancelJob(j) {
    if (!window.confirm(`Cancel job ${j.job_number}? The supplier will be emailed.`)) return;
    try { await api(`/jobs/${j.id}/cancel`, 'POST'); toast('Job cancelled.'); await reload(); } catch (err) { toast(err.message); }
  }

  async function deleteJob(j) {
    if (!window.confirm(`Delete cancelled job ${j.job_number} permanently?`)) return;
    try { await api(`/jobs/${j.id}`, 'DELETE'); await reload(); } catch (err) { toast(err.message); }
  }

  async function setPaid(j, paid) {
    let ref = '';
    if (paid) {
      ref = window.prompt(`Mark ${money.format(j.pay_cents / 100)} as paid to ${j.cleaner_name} for job ${j.job_number}?\n\nPayment reference (optional, e.g. e-Transfer #):`, '');
      if (ref == null) return;
    }
    try { await api(`/jobs/${j.id}/paid`, 'POST', { paid, ref }); await reload(); } catch (err) { toast(err.message); }
  }

  function selectFilter() {
    document.querySelectorAll('[data-jobfilter]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.jobfilter === jobsState.filter)));
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('job-form').addEventListener('submit', submitJob);
    $('job-cancel-edit').addEventListener('click', resetForm);
    $('j-cleaner').addEventListener('change', suggestPay);
    $('j-service').addEventListener('change', suggestPay);
    $('j-pay').addEventListener('input', updateHints);
    $('j-client').addEventListener('change', onClientChange);
    $('job-search').addEventListener('input', renderJobs);
    $('cal-supplier').addEventListener('change', (e) => { cal.supplier = e.target.value; renderJobs(); });
    document.querySelectorAll('[data-jobview]').forEach((b) => b.addEventListener('click', () => {
      cal.view = b.dataset.jobview;
      try { localStorage.setItem(VIEW_KEY, cal.view); } catch { /* storage blocked */ }
      renderJobs();
    }));
    document.querySelectorAll('[data-jobfilter]').forEach((t) => t.addEventListener('click', () => { jobsState.filter = t.dataset.jobfilter; selectFilter(); renderJobs(); }));
    // Refresh supplier/client dropdowns whenever the Jobs tab is opened.
    document.querySelector('.admin-tabs .tab[data-view="jobs"]').addEventListener('click', () => { fillSelects(); reload(); });
    // admin.js loads clients and suppliers; refill the dropdowns whenever that data changes.
    document.addEventListener('admin:data', fillSelects);
    reload();
  });
})();
