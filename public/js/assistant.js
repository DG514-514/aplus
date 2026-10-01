'use strict';

// Ace: talk to your A+ colleague by voice, have Ace sit in on meetings, and keep notes.
// Speech-to-text: the browser's SpeechRecognition. Voice: speechSynthesis. Thinking: /api/admin/assistant (Claude).
(() => {
  const $ = (id) => document.getElementById(id);
  const face = () => window.AceFace;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE = /\b(?:hey|hi|ok|okay|yo)[\s,]+(?:ace|a\.?\s?s\.?|ase|ice|acey)\b[\s,.:!?]*/i;
  const SEND_AFTER_PAUSE_MS = 1100;
  const MEETING_CONTEXT_CHARS = 12000;

  /* ---------- Helpers ---------- */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch(`/api/admin/assistant${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    if (res.status === 401) { window.location.replace('/admin?next=/ace'); throw new Error('Signed out'); }
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
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  const fmtWhen = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  /* ---------- State ---------- */

  let configured = false;
  let mode = 'talk';           // talk | meeting
  let micOn = false;           // talk mode: hands-free conversation running
  let busy = false;            // waiting on Ace
  let speaking = false;
  let conversationId = null;
  let recognition = null;
  let recognizing = false;
  let pendingText = '';
  let sendTimer = null;

  const meeting = { active: false, paused: false, started: 0, elapsed: 0, lines: [], timer: null, awaitingQuestion: 0, wakeLock: null };

  function setState(next, label) {
    face()?.setState(next === 'speaking' ? 'idle' : next);
    $('ace-state').textContent = label;
    $('ace-state').dataset.state = next;
  }

  function refreshIdleState() {
    if (speaking || busy) return;
    if (mode === 'meeting' && meeting.active) {
      setState(meeting.paused ? 'idle' : 'listening', meeting.paused ? 'Meeting paused' : 'In the meeting — say “Hey Ace” to ask me something');
    } else if (micOn) {
      setState('listening', 'Listening…');
    } else {
      setState('idle', configured ? 'Ready when you are' : 'Ace isn’t switched on yet');
    }
  }

  /* ---------- Voice out ---------- */

  let voices = [];
  function pickVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    const select = $('ace-voice');
    const saved = store.get('ace-voice');
    // Ace has a woman's voice: prefer natural-sounding female voices.
    const female = /samantha|ava|allison|susan|zoe|karen|moira|tessa|serena|victoria|fiona|aria|jenny|michelle|emma|libby|sonia|natasha|joanna|salli|kendra|kimberly|female|google us english|google uk english female/i;
    const natural = /natural|neural|premium|enhanced/i;
    const rank = (v) => (female.test(v.name) ? 0 : 2) + (natural.test(v.name) ? 0 : 1);
    voices.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    select.replaceChildren(...voices.map((v) => el('option', { value: v.name }, `${v.name.replace(/Microsoft |Google /, '')} (${v.lang})`)));
    if (saved && voices.some((v) => v.name === saved)) select.value = saved;
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!$('ace-speak').checked || !('speechSynthesis' in window) || !text) { resolve(); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ''));
      const voice = voices.find((v) => v.name === $('ace-voice').value);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = 1.03;
      u.pitch = 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speaking = false;
        face()?.stopTalking();
        $('ace-stop-talking').hidden = true;
        resolve();
      };
      u.onstart = () => {
        speaking = true;
        face()?.startTalking();
        setState('speaking', 'Speaking…');
        $('ace-stop-talking').hidden = false;
      };
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        const rest = text.slice(e.charIndex);
        const word = (rest.match(/^[\w'’áéö-]+/) || [''])[0];
        face()?.word(word, u.rate);
      };
      u.onend = finish;
      u.onerror = finish;
      // Safety net if the browser never fires onend.
      setTimeout(finish, Math.max(4000, text.length * 95));
      speechSynthesis.speak(u);
    });
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  /* ---------- Speech recognition ---------- */

  function ensureRecognition() {
    if (recognition || !SpeechRecognition) return recognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language && /^en/i.test(navigator.language) ? navigator.language : 'en-US';
    recognition.onresult = onResult;
    recognition.onstart = () => { recognizing = true; };
    recognition.onend = () => {
      recognizing = false;
      // Browsers stop after silence; keep listening while we should be.
      if (shouldListen()) setTimeout(startListening, 250);
    };
    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micOn = false;
        if (meeting.active) pauseMeeting(true);
        renderMic();
        toast('Microphone access is blocked. Allow the microphone for this site in your browser settings.');
      }
    };
    return recognition;
  }

  const shouldListen = () => !speaking && !busy && ((mode === 'talk' && micOn) || (meeting.active && !meeting.paused));

  function startListening() {
    if (!ensureRecognition() || recognizing || !shouldListen()) return;
    try { recognition.start(); } catch { /* already starting */ }
  }

  function stopListening() {
    if (recognition && recognizing) {
      try { recognition.stop(); } catch { /* ignore */ }
    }
  }

  function onResult(event) {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const r = event.results[i];
      const text = r[0].transcript.trim();
      if (!text) continue;
      if (r.isFinal) {
        if (meeting.active) onMeetingSpeech(text);
        else onTalkSpeech(text);
      } else {
        interim += `${text} `;
      }
    }
    if (meeting.active) $('ace-meeting-interim').textContent = interim;
    else {
      $('ace-heard').textContent = (pendingText + ' ' + interim).trim();
      if (interim) clearTimeout(sendTimer);
      else if (pendingText) scheduleSend();
    }
  }

  /* ---------- Talk mode ---------- */

  function onTalkSpeech(text) {
    if (mode !== 'talk' || !micOn || busy || speaking) return;
    pendingText = `${pendingText} ${text}`.trim();
    $('ace-heard').textContent = pendingText;
    scheduleSend();
  }

  function scheduleSend() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      const text = pendingText;
      pendingText = '';
      if (text) ask(text);
    }, SEND_AFTER_PAUSE_MS);
  }

  function logLine(who, text, extra) {
    const log = $('ace-log');
    log.querySelector('.ace-hint')?.remove();
    const item = el('div', { class: `ace-msg ace-msg-${who}` }, el('span', { class: 'ace-who' }, who === 'you' ? 'You' : 'Ace'), el('p', {}, text), extra || null);
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  async function ask(text, { meetingTranscript = null, quiet = false } = {}) {
    if (!configured) { toast('Ace isn’t switched on yet — see the note under Ace’s face.'); return null; }
    busy = true;
    stopListening();
    stopSpeaking();
    $('ace-heard').textContent = '';
    setState('thinking', 'Thinking…');
    if (!meetingTranscript) logLine('you', text);
    let reply = null;
    try {
      const data = await api('/chat', 'POST', { conversationId, text, meetingTranscript });
      conversationId = data.conversationId;
      reply = data.reply;
      const saved = data.notes?.length ? el('span', { class: 'ace-saved' }, `📝 Saved to Notes: ${data.notes.map((n) => n.title).join(', ')}`) : null;
      if (meetingTranscript) addTranscriptLine('Ace', reply, true);
      else logLine('ace', reply, saved);
      if (data.notes?.length) loadNotes();
      $('ace-caption').textContent = reply;
      busy = false;
      if (!quiet) await speak(reply);
    } catch (err) {
      busy = false;
      if (err.message !== 'Signed out') {
        toast(err.message);
        $('ace-caption').textContent = err.message;
      }
    }
    busy = false;
    refreshIdleState();
    startListening();
    return reply;
  }

  function renderMic() {
    const btn = $('ace-mic');
    btn.setAttribute('aria-pressed', String(micOn));
    btn.setAttribute('aria-label', micOn ? 'Turn microphone off' : 'Turn microphone on');
    btn.classList.toggle('is-on', micOn);
    btn.disabled = meeting.active;
    $('ace-mic-label').textContent = meeting.active ? 'Ace is in a meeting'
      : micOn ? 'Listening — just talk. Tap to stop.' : SpeechRecognition ? 'Tap the mic and talk to Ace' : 'Voice input isn’t supported in this browser — type below (Chrome, Edge or Safari support voice)';
    refreshIdleState();
  }

  function toggleMic() {
    if (!SpeechRecognition) { toast('Voice input needs Chrome, Edge or Safari. You can still type to Ace.'); return; }
    micOn = !micOn;
    if (micOn) {
      // Unlock audio on iOS: speech must start from a tap.
      if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      startListening();
    } else {
      clearTimeout(sendTimer);
      pendingText = '';
      $('ace-heard').textContent = '';
      stopListening();
    }
    renderMic();
  }

  /* ---------- Meeting mode ---------- */

  const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function addTranscriptLine(who, text, isAce = false) {
    const at = meeting.elapsed + (meeting.paused ? 0 : Date.now() - meeting.started);
    meeting.lines.push({ at, who, text });
    const box = $('ace-transcript');
    box.append(el('p', { class: isAce ? 'ace-line ace-line-ace' : 'ace-line' }, el('time', {}, clock(at)), ' ', isAce ? el('strong', {}, 'Ace: ') : null, text));
    box.scrollTop = box.scrollHeight;
  }

  const transcriptText = () => meeting.lines.map((l) => `[${clock(l.at)}] ${l.who === 'Ace' ? 'Ace: ' : ''}${l.text}`).join('\n');

  function onMeetingSpeech(text) {
    if (meeting.paused || speaking || busy) return;
    $('ace-meeting-interim').textContent = '';
    addTranscriptLine('room', text);
    const wake = text.match(WAKE);
    let question = null;
    if (wake) {
      question = text.slice(wake.index + wake[0].length).trim();
      if (!question) { meeting.awaitingQuestion = Date.now(); setState('listening', 'Yes? I’m listening…'); return; }
    } else if (meeting.awaitingQuestion && Date.now() - meeting.awaitingQuestion < 10000) {
      question = text;
    }
    if (question) {
      meeting.awaitingQuestion = 0;
      ask(question, { meetingTranscript: transcriptText().slice(-MEETING_CONTEXT_CHARS) });
    }
  }

  function tick() {
    $('ace-timer').textContent = clock(meeting.elapsed + (meeting.paused ? 0 : Date.now() - meeting.started));
  }

  async function startMeeting() {
    if (!SpeechRecognition) { toast('Meeting mode needs voice input — use Chrome, Edge or Safari.'); return; }
    if (micOn) toggleMic();
    Object.assign(meeting, { active: true, paused: false, started: Date.now(), elapsed: 0, lines: [], awaitingQuestion: 0 });
    $('ace-transcript').replaceChildren();
    $('ace-meeting-setup').hidden = true;
    $('ace-meeting-live').hidden = false;
    $('ace-meeting-pause').textContent = 'Pause';
    $('ace-rec').classList.remove('is-paused');
    meeting.timer = setInterval(tick, 1000);
    try { meeting.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
    renderMic();
    startListening();
  }

  function pauseMeeting(force) {
    if (!meeting.active) return;
    const pause = force === true ? true : !meeting.paused;
    if (pause && !meeting.paused) { meeting.elapsed += Date.now() - meeting.started; meeting.paused = true; stopListening(); }
    else if (!pause && meeting.paused) { meeting.started = Date.now(); meeting.paused = false; startListening(); }
    $('ace-meeting-pause').textContent = meeting.paused ? 'Resume' : 'Pause';
    $('ace-rec').textContent = meeting.paused ? '❚❚ Paused' : '● Recording';
    $('ace-rec').classList.toggle('is-paused', meeting.paused);
    refreshIdleState();
  }

  async function endMeeting() {
    if (!meeting.active) return;
    if (!meeting.paused) meeting.elapsed += Date.now() - meeting.started;
    meeting.active = false;
    meeting.paused = false;
    clearInterval(meeting.timer);
    stopListening();
    stopSpeaking();
    meeting.wakeLock?.release?.().catch(() => {});
    const transcript = transcriptText();
    const btn = $('ace-meeting-end');
    btn.disabled = true;
    btn.textContent = 'Writing up notes…';
    setState('thinking', 'Writing up the meeting notes…');
    try {
      const { note } = await api('/meeting/summary', 'POST', { title: $('ace-meeting-title').value.trim(), transcript });
      toast('Meeting notes saved.');
      await loadNotes();
      showPanel('notes');
      $(`note-${note.id}`)?.classList.add('is-open');
      speak(`All done. I've saved the notes for ${note.title}.`);
    } catch (err) {
      toast(err.message);
      if (transcript) await api('/notes', 'POST', { title: `${$('ace-meeting-title').value.trim() || 'Meeting'} — transcript`, body: transcript }).catch(() => {});
      loadNotes();
    } finally {
      btn.disabled = false;
      btn.textContent = 'End & Summarize';
      $('ace-meeting-setup').hidden = false;
      $('ace-meeting-live').hidden = true;
      $('ace-meeting-title').value = '';
      renderMic();
    }
  }

  /* ---------- Notes ---------- */

  let notes = [];

  async function loadNotes() {
    try {
      ({ notes } = await api('/notes'));
      renderNotes();
    } catch (err) {
      if (err.message !== 'Signed out') toast(err.message);
    }
  }

  function renderNotes() {
    const q = $('ace-notes-search').value.trim().toLowerCase();
    const list = $('ace-notes');
    const rows = notes.filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q));
    $('ace-notes-count').textContent = notes.length || '';
    $('ace-notes-empty').hidden = rows.length > 0;
    list.replaceChildren(...rows.map((n) => {
      const card = el('article', { class: `ace-note${n.kind === 'meeting' ? ' is-meeting' : ''}`, id: `note-${n.id}` });
      const head = el('button', { type: 'button', class: 'ace-note-head', onclick: () => card.classList.toggle('is-open') },
        el('span', { class: 'ace-note-kind' }, n.kind === 'meeting' ? '👥 Meeting' : '📝 Note'),
        el('strong', {}, n.title),
        el('time', {}, fmtWhen(n.created_at)));
      const actions = el('div', { class: 'ace-note-actions' },
        el('button', { type: 'button', class: 'link-btn', onclick: () => copyText(`${n.title}\n\n${n.body}`) }, 'Copy'),
        n.has_transcript ? el('button', { type: 'button', class: 'link-btn', onclick: (e) => showTranscript(n, card, e.currentTarget) }, 'Full transcript') : null,
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteNote(n) }, 'Delete'));
      card.append(head, el('div', { class: 'ace-note-body' }, el('p', { class: 'ace-note-text' }, n.body), actions));
      return card;
    }));
  }

  async function showTranscript(n, card, btn) {
    const existing = card.querySelector('.ace-note-transcript');
    if (existing) { existing.remove(); btn.textContent = 'Full transcript'; return; }
    try {
      const { transcript } = await api(`/notes/${n.id}/transcript`);
      card.querySelector('.ace-note-body').append(el('pre', { class: 'ace-note-transcript' }, transcript));
      btn.textContent = 'Hide transcript';
    } catch (err) { toast(err.message); }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Couldn’t copy on this device.'); }
  }

  async function deleteNote(n) {
    if (!window.confirm(`Delete “${n.title}”?`)) return;
    try { await api(`/notes/${n.id}`, 'DELETE'); await loadNotes(); } catch (err) { toast(err.message); }
  }

  /* ---------- Panels ---------- */

  function showPanel(name) {
    document.querySelectorAll('.ace-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.panel === name)));
    for (const p of ['talk', 'meeting', 'notes']) $(`panel-${p}`).hidden = p !== name;
    if (name === 'meeting' || name === 'talk') {
      mode = meeting.active ? 'meeting' : (name === 'meeting' ? 'meeting' : 'talk');
      renderMic();
    }
  }

  /* ---------- Start ---------- */

  document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.ace-tab').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.panel)));
    $('ace-mic').addEventListener('click', toggleMic);
    $('ace-stop-talking').addEventListener('click', stopSpeaking);
    $('ace-type-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('ace-text').value.trim();
      if (!text || busy) return;
      $('ace-text').value = '';
      if (meeting.active) ask(text, { meetingTranscript: transcriptText().slice(-MEETING_CONTEXT_CHARS) });
      else { showPanel('talk'); ask(text); }
    });
    $('ace-ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('ace-ask').value.trim();
      if (!text || busy) return;
      $('ace-ask').value = '';
      ask(text, { meetingTranscript: transcriptText().slice(-MEETING_CONTEXT_CHARS), quiet: true });
    });
    $('ace-new').addEventListener('click', () => {
      conversationId = null;
      $('ace-log').replaceChildren(el('p', { class: 'ace-hint' }, 'New conversation started. What’s on your mind?'));
      $('ace-caption').textContent = '';
    });
    $('ace-meeting-start').addEventListener('click', startMeeting);
    $('ace-meeting-pause').addEventListener('click', pauseMeeting);
    $('ace-meeting-end').addEventListener('click', endMeeting);
    $('ace-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = $('ace-note-text').value.trim();
      if (!body) return;
      try { await api('/notes', 'POST', { body }); $('ace-note-text').value = ''; loadNotes(); } catch (err) { toast(err.message); }
    });
    $('ace-notes-search').addEventListener('input', renderNotes);
    $('ace-speak').checked = store.get('ace-speak') !== 'off';
    $('ace-speak').addEventListener('change', () => { store.set('ace-speak', $('ace-speak').checked ? 'on' : 'off'); if (!$('ace-speak').checked) stopSpeaking(); });
    $('ace-voice').addEventListener('change', () => { store.set('ace-voice', $('ace-voice').value); speak('Hi, this is how I sound.'); });
    $('ace-signout').addEventListener('click', async () => {
      try { await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } finally { window.location.assign('/admin'); }
    });
    window.addEventListener('beforeunload', (e) => { if (meeting.active) { e.preventDefault(); e.returnValue = ''; } });

    if ('speechSynthesis' in window) {
      pickVoices();
      speechSynthesis.addEventListener?.('voiceschanged', pickVoices);
    } else {
      $('ace-speak').checked = false;
      $('ace-speak').disabled = true;
    }

    try {
      ({ configured } = await api('/status'));
    } catch { configured = false; }
    if (!configured) {
      $('ace-caption').textContent = 'To switch Ace on, add your ANTHROPIC_API_KEY in Render → Environment (get one at console.anthropic.com). Notes work already.';
    }
    renderMic();
    loadNotes();
  });
})();
