'use strict';

// Shared pieces for supplier jobs, used by the supplier portal and the owner dashboard.
window.JobsUI = (() => {
  const CURRENCY = ((window.APLUS && window.APLUS.currency) || 'usd').toUpperCase();
  const money = new Intl.NumberFormat(CURRENCY === 'CAD' ? 'en-CA' : 'en-US', { style: 'currency', currency: CURRENCY });

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child != null && child !== false) node.append(child);
    return node;
  }

  const LOCALE = () => (window.I18N ? window.I18N.locale() : 'en-CA');
  const parseDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) => parseDate(iso).toLocaleDateString(LOCALE(), opts);
  const fmtTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE(), { hour: 'numeric', minute: '2-digit' }); };
  const fmtStamp = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleString(LOCALE(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function whenText(j) {
    let t = fmtDate(j.service_date);
    if (j.time_start) t += ` · ${fmtTime(j.time_start)}${j.time_end ? `–${fmtTime(j.time_end)}` : ''}`;
    return t;
  }

  function sizeText(j) {
    return [j.bedrooms && (j.bedrooms === 'Studio' ? 'Studio' : `${j.bedrooms} bed`), j.bathrooms && `${j.bathrooms} bath`].filter(Boolean).join(' · ');
  }

  // [badge class, label] for a job, from the viewer's point of view.
  function status(j, viewer) {
    if (j.status === 'requested') {
      if (viewer === 'owner') return j.awaiting_owner ? ['badge-reply', 'Supplier replied'] : ['badge-scheduled', 'Awaiting supplier'];
      return ['badge-scheduled', 'New request'];
    }
    if (j.status === 'accepted') return j.cleaner_submitted_at ? ['badge-reply', 'Ready for review'] : ['badge-pending', 'Pending completion'];
    if (j.status === 'completed') return j.supplier_paid_at ? ['badge-completed', 'Completed · Paid'] : ['badge-unpaid', 'Completed · Unpaid'];
    return ['badge-cancelled', 'Cancelled'];
  }

  const mapLink = (j) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.address)}`;

  // Key job facts shown on every card.
  function details(j, viewer) {
    return el('dl', { class: 'job-facts' },
      el('div', {}, el('dt', {}, 'Address'), el('dd', {}, el('a', { href: mapLink(j), target: '_blank', rel: 'noopener' }, j.address), j.unit ? `, Unit ${j.unit}` : '')),
      el('div', {}, el('dt', {}, 'When'), el('dd', {}, whenText(j))),
      sizeText(j) || j.service ? el('div', {}, el('dt', {}, 'Unit'), el('dd', {}, [sizeText(j), j.service].filter(Boolean).join(' · '))) : null,
      j.client_name ? el('div', {}, el('dt', {}, 'Client'), el('dd', {}, j.client_name)) : null,
      viewer === 'owner' ? el('div', {}, el('dt', {}, 'Supplier'), el('dd', {}, j.cleaner_company ? `${j.cleaner_name} (${j.cleaner_company})` : j.cleaner_name)) : null,
      el('div', {}, el('dt', {}, viewer === 'owner' ? 'Pay to supplier' : 'Pay'), el('dd', { class: 'job-pay' }, money.format(j.pay_cents / 100))));
  }

  // Comment thread with a reply box. `send(text)` returns a promise.
  function thread(j, viewer, send, { open = true } = {}) {
    const wrap = el('div', { class: 'job-thread' });
    if (j.messages.length) {
      wrap.append(el('ul', { class: 'job-messages' }, ...j.messages.map((m) => el('li', { class: `job-msg ${m.author === viewer ? 'mine' : 'theirs'}` },
        el('span', { class: 'job-msg-who' }, `${m.author === 'owner' ? 'A+ Cleaning' : (viewer === 'owner' ? j.cleaner_name : 'You')} · ${fmtStamp(m.created_at)}`),
        el('p', {}, m.body)))));
    }
    if (open) {
      const input = el('textarea', { rows: '2', maxlength: '2000', placeholder: viewer === 'owner' ? 'Reply to the supplier…' : 'Reply with a comment or question…', 'aria-label': 'Comment' });
      const btn = el('button', { type: 'submit', class: 'btn btn-outline btn-sm' }, viewer === 'owner' ? 'Send Reply' : 'Send Comment');
      const form = el('form', { class: 'job-reply' }, input, btn);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        btn.disabled = true;
        try { await send(text); } finally { btn.disabled = false; }
      });
      wrap.append(form);
    }
    return wrap;
  }

  // Before / after photo strips. `src(photo)` gives the image URL; `onDelete` is optional.
  function photos(j, src, onDelete) {
    const strip = (kind, label) => {
      const list = j.photos.filter((p) => p.kind === kind);
      return el('div', { class: 'job-photo-group' },
        el('h4', {}, window.I18N ? window.I18N.t(`${label} ({n})`, { n: list.length }) : `${label} (${list.length})`),
        list.length ? el('div', { class: 'job-photos' }, ...list.map((p) => el('figure', {},
          el('a', { href: src(p), target: '_blank', rel: 'noopener' }, el('img', { src: src(p), alt: `${label} photo`, loading: 'lazy' })),
          onDelete ? el('button', { type: 'button', class: 'job-photo-del', 'aria-label': 'Remove photo', onclick: () => onDelete(p) }, '×') : null)))
          : el('p', { class: 'sub' }, 'None yet.'));
    };
    return el('div', { class: 'job-photo-wrap' }, strip('before', 'Before'), strip('after', 'After'));
  }

  // Phone photos are large: resize to max 1600px and re-encode as JPEG before upload.
  async function compressImage(file) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (blob) return blob;
    } catch { /* fall back to the original file */ }
    return file;
  }

  /* ---------- Calendar ---------- */

  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = () => isoOf(new Date());

  // Colour group for a job on the calendar.
  function calKind(j) {
    if (j.status === 'requested') return 'req';
    if (j.status === 'accepted') return j.cleaner_submitted_at ? 'review' : 'conf';
    if (j.status === 'completed') return j.supplier_paid_at ? 'paid' : 'unpaid';
    return 'cxl';
  }
  const LEGEND = [['req', 'New request'], ['conf', 'Confirmed'], ['review', 'Ready for review'], ['unpaid', 'Completed · unpaid'], ['paid', 'Completed · paid'], ['cxl', 'Cancelled']];

  const shortTime = (hhmm) => fmtTime(hhmm).replace(':00', '').replace(/\s?([ap])\.?m\.?/i, (m, x) => x.toLowerCase());
  const street = (j) => j.address.split(',')[0];

  // Month calendar (grid on wide screens, agenda list on phones).
  // opts: { jobs, viewer, month: 'YYYY-MM', selected: 'YYYY-MM-DD', onMonth(ym), onDay(iso), label(j) }
  function calendar({ jobs, viewer, month, selected, onMonth, onDay, label }) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const byDay = {};
    for (const j of jobs) (byDay[j.service_date] = byDay[j.service_date] || []).push(j);
    for (const list of Object.values(byDay)) list.sort((a, b) => (a.time_start || '99').localeCompare(b.time_start || '99'));
    const today = todayIso();
    const chipText = label || ((j) => [j.time_start ? shortTime(j.time_start) : null, street(j)].filter(Boolean).join(' · '));
    const chip = (j) => el('button', {
      type: 'button', class: `cal-chip k-${calKind(j)}`,
      title: [`Job ${j.job_number}`, whenText(j), j.address, viewer === 'owner' ? (j.cleaner_company || j.cleaner_name) : null, status(j, viewer)[1]].filter(Boolean).join(' · '),
      onclick: (e) => { e.stopPropagation(); onDay(j.service_date, j); },
    }, chipText(j));

    // Month totals (cancelled jobs don't count).
    const inMonth = jobs.filter((j) => j.service_date.startsWith(month) && j.status !== 'cancelled');
    const done = inMonth.filter((j) => j.status === 'completed');
    const earned = done.reduce((sum, j) => sum + j.pay_cents, 0);
    const owed = done.filter((j) => !j.supplier_paid_at).reduce((sum, j) => sum + j.pay_cents, 0);
    const summary = inMonth.length
      ? `${inMonth.length} job${inMonth.length === 1 ? '' : 's'} · ${done.length} completed · ${money.format(earned / 100)} ${viewer === 'owner' ? 'supplier cost' : 'earned'} · ${money.format(owed / 100)} ${viewer === 'owner' ? 'owed' : 'still owed'}`
      : 'No jobs this month';

    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
    const head = el('div', { class: 'cal-head' },
      el('div', { class: 'cal-nav' },
        el('button', { type: 'button', class: 'cal-arrow', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
        el('h3', { class: 'cal-title' }, first.toLocaleDateString(LOCALE(), { month: 'long', year: 'numeric' })),
        el('button', { type: 'button', class: 'cal-arrow', 'aria-label': 'Next month', onclick: () => shift(1) }, '›'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { onMonth(today.slice(0, 7)); onDay(today); } }, 'Today')),
      el('p', { class: 'cal-summary' }, summary));

    const legend = el('ul', { class: 'cal-legend', 'aria-label': 'Colour key' },
      ...LEGEND.map(([k, text]) => el('li', {}, el('span', { class: `cal-dot k-${k}`, 'aria-hidden': 'true' }), text)));

    // Grid: weeks start on Sunday.
    const grid = el('div', { class: 'cal-grid', role: 'grid' });
    const weekday = new Date(2023, 0, 1); // a Sunday
    for (let i = 0; i < 7; i += 1) {
      grid.append(el('div', { class: 'cal-wd', role: 'columnheader' }, new Date(weekday.getFullYear(), 0, 1 + i).toLocaleDateString(LOCALE(), { weekday: 'short' })));
    }
    const lead = first.getDay();
    const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
    for (let i = 0; i < cells; i += 1) {
      const d = new Date(y, m - 1, 1 - lead + i);
      const iso = isoOf(d);
      const list = byDay[iso] || [];
      const out = d.getMonth() !== m - 1;
      const shown = list.slice(0, 3);
      grid.append(el('div', {
        class: `cal-cell${out ? ' out' : ''}${iso === today ? ' today' : ''}${iso === selected ? ' selected' : ''}`,
        role: 'gridcell', tabindex: '0', 'aria-label': `${fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric' })}: ${list.length} job${list.length === 1 ? '' : 's'}`,
        onclick: () => onDay(iso), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDay(iso); } },
      },
      el('span', { class: 'cal-num' }, String(d.getDate())),
      ...shown.map(chip),
      list.length > shown.length ? el('span', { class: 'cal-more' }, `+${list.length - shown.length} more`) : null));
    }

    // Agenda (phones): only days in this month that have jobs, plus today.
    const agenda = el('div', { class: 'cal-agenda' });
    const days = Object.keys(byDay).filter((iso) => iso.startsWith(month));
    if (today.startsWith(month) && !days.includes(today)) days.push(today);
    days.sort();
    const tomorrow = isoOf(new Date(Date.now() + 864e5));
    for (const iso of days) {
      const list = byDay[iso] || [];
      const name = iso === today ? 'Today' : iso === tomorrow ? 'Tomorrow' : fmtDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
      agenda.append(el('div', { class: `cal-aday${iso === selected ? ' selected' : ''}${iso === today ? ' today' : ''}` },
        el('button', { type: 'button', class: 'cal-adate', onclick: () => onDay(iso) }, name, list.length ? null : el('span', { class: 'sub' }, ' · no jobs')),
        list.length ? el('div', { class: 'cal-alist' }, ...list.map(chip)) : null));
    }
    if (!days.length) agenda.append(el('p', { class: 'empty' }, 'No jobs this month.'));

    return el('div', { class: 'cal' }, head, legend, grid, agenda);
  }

  // "Add to my phone calendar" box: fetch(reset) returns { url, webcal, google }.
  function calendarSync({ title, intro, fetchLinks, toast }) {
    const box = el('div', { class: 'cal-sync' });
    const show = async (reset) => {
      try {
        const links = await fetchLinks(reset);
        const copy = async () => {
          try { await navigator.clipboard.writeText(links.url); toast('Calendar link copied.'); } catch { window.prompt('Copy this calendar link:', links.url); }
        };
        box.replaceChildren(
          el('h4', {}, title),
          el('p', { class: 'sub' }, 'Jobs appear in your calendar and update by themselves. Keep this link private — anyone with it can see the jobs.'),
          el('div', { class: 'job-link-actions' },
            el('a', { class: 'btn btn-primary btn-sm', href: links.google, target: '_blank', rel: 'noopener' }, 'Google Calendar'),
            el('a', { class: 'btn btn-outline btn-sm', href: links.webcal }, 'iPhone / Mac / Outlook'),
            el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: copy }, 'Copy Link'),
            el('button', { type: 'button', class: 'cal-reset', onclick: () => { if (window.confirm('Make a new link? Calendars using the old link stop updating.')) show(true); } }, 'Reset link')),
          el('p', { class: 'sub' }, 'Google can take a few hours to show changes; iPhone and Outlook usually refresh within the hour.'));
      } catch (err) { toast(err.message); }
    };
    box.append(el('h4', {}, title), el('p', { class: 'sub' }, intro),
      el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => show(false) }, '📅 Add to My Phone Calendar'));
    return box;
  }

  return { el, money, fmtDate, fmtTime, fmtStamp, whenText, sizeText, status, details, thread, photos, compressImage, calendar, calendarSync, calKind, todayIso, shortTime };
})();
