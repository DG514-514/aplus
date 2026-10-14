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

  return { el, money, fmtDate, fmtTime, fmtStamp, whenText, sizeText, status, details, thread, photos, compressImage };
})();
