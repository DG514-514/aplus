'use strict';

// Ace's animated face: blinking, eye movement, head motion and lip-sync driven by the words being spoken.
// Exposes window.AceFace. Everything is SVG attributes + CSSOM (no inline styles, per the site CSP).
(() => {
  const $ = (id) => document.getElementById(id);
  const MOUTH = { cx: 200, cy: 302, halfWidth: 27 };

  // Mouth shapes (visemes): open = px the lips part, width = horizontal scale, smile = corner lift.
  const SHAPES = {
    rest: { open: 0.6, width: 1, smile: 1 },
    smile: { open: 2, width: 1.06, smile: 1.6 },
    a: { open: 15, width: 1.02, smile: 0.4 },
    e: { open: 8, width: 1.14, smile: 0.9 },
    i: { open: 5.5, width: 1.12, smile: 1 },
    o: { open: 13, width: 0.72, smile: 0.1 },
    u: { open: 6, width: 0.62, smile: 0 },
    m: { open: 0, width: 0.94, smile: 0.4 },
    f: { open: 2.5, width: 1, smile: 0.3 },
    th: { open: 4, width: 1, smile: 0.4 },
    c: { open: 5, width: 1, smile: 0.5 },
  };

  function shapeFor(ch, next) {
    if ('aá'.includes(ch)) return SHAPES.a;
    if (ch === 'o' && next === 'o') return SHAPES.u;
    if ('oöw'.includes(ch)) return SHAPES.o;
    if ('uq'.includes(ch)) return SHAPES.u;
    if ('eé'.includes(ch)) return SHAPES.e;
    if ('iy'.includes(ch)) return SHAPES.i;
    if ('mbp'.includes(ch)) return SHAPES.m;
    if ('fv'.includes(ch)) return SHAPES.f;
    if (ch === 't' && next === 'h') return SHAPES.th;
    if (/[a-z0-9]/.test(ch)) return SHAPES.c;
    return SHAPES.rest;
  }

  let current = { ...SHAPES.rest };
  let target = SHAPES.rest;
  let queue = [];           // [{ at: ms timestamp, shape }]
  let talking = false;
  let lastWordAt = 0;
  let state = 'idle';
  let gaze = { x: 0, y: 0 };
  let gazeTarget = { x: 0, y: 0 };
  let blinkUntil = 0;
  let nextBlink = performance.now() + 2500;
  let nextGlance = performance.now() + 1800;
  let started = false;

  function mouthPaths({ open, width, smile }) {
    const { cx, cy } = MOUTH;
    const w = MOUTH.halfWidth * width;
    const corner = cy - smile * 2.2;
    const upperInner = cy - open * 0.28;
    const lowerInner = cy + open * 0.72;
    const ctrl = (y, from) => 2 * y - from; // quadratic control so the curve's midpoint lands on y
    const wi = w * 0.9;
    return {
      inner: `M${cx - wi} ${corner} Q${cx} ${ctrl(upperInner, corner)} ${cx + wi} ${corner} Q${cx} ${ctrl(lowerInner, corner)} ${cx - wi} ${corner}Z`,
      upper: `M${cx - w} ${corner} C${cx - w * 0.6} ${cy - 7 - open * 0.25} ${cx - w * 0.22} ${cy - 10 - open * 0.25} ${cx} ${cy - 6.5 - open * 0.25} `
        + `C${cx + w * 0.22} ${cy - 10 - open * 0.25} ${cx + w * 0.6} ${cy - 7 - open * 0.25} ${cx + w} ${corner} `
        + `Q${cx} ${ctrl(upperInner + 0.6, corner)} ${cx - w} ${corner}Z`,
      lower: `M${cx - w} ${corner} Q${cx} ${ctrl(lowerInner - 0.4, corner)} ${cx + w} ${corner} `
        + `Q${cx} ${ctrl(lowerInner + 9.5 - open * 0.08, corner)} ${cx - w} ${corner}Z`,
      upperInner, lowerInner, w: wi,
    };
  }

  function drawMouth() {
    const p = mouthPaths(current);
    $('mouth-inner').setAttribute('d', p.inner);
    $('mouth-clip-path').setAttribute('d', p.inner);
    $('lip-upper').setAttribute('d', p.upper);
    $('lip-lower').setAttribute('d', p.lower);
    const teeth = $('mouth-teeth');
    teeth.setAttribute('x', String(MOUTH.cx - p.w));
    teeth.setAttribute('width', String(p.w * 2));
    teeth.setAttribute('y', String(p.upperInner - 1));
    teeth.setAttribute('height', String(Math.max(0, current.open * 0.32)));
    $('mouth-tongue').setAttribute('cy', String(p.lowerInner + 2));
  }

  function frame(now) {
    // Lip-sync queue → target shape.
    while (queue.length && queue[0].at <= now) target = queue.shift().shape;
    if (talking && !queue.length && now - lastWordAt > 420) {
      // No word timing from the voice (some browsers don't send it): natural-looking babble.
      if (!frame.babbleAt || now > frame.babbleAt) {
        const pool = [SHAPES.a, SHAPES.e, SHAPES.o, SHAPES.c, SHAPES.m, SHAPES.i, SHAPES.c];
        target = pool[Math.floor(Math.random() * pool.length)];
        frame.babbleAt = now + 70 + Math.random() * 70;
      }
    }
    if (!talking && !queue.length) target = state === 'idle' || state === 'listening' ? SHAPES.rest : SHAPES.rest;
    const k = talking ? 0.42 : 0.18;
    for (const key of ['open', 'width', 'smile']) current[key] += (target[key] - current[key]) * k;
    drawMouth();

    // Blinks.
    if (now > nextBlink) {
      blinkUntil = now + 130;
      nextBlink = now + 2200 + Math.random() * 3800;
      if (Math.random() < 0.18) nextBlink = now + 260; // occasional double blink
    }
    const lidScale = now < blinkUntil ? 1 : (state === 'thinking' ? 0.22 : 0.08);
    for (const id of ['lid-l', 'lid-r']) $(id).style.transform = `scaleY(${lidScale})`;

    // Eyes: look at you while listening/speaking, glance around when idle, up while thinking.
    if (now > nextGlance) {
      if (state === 'thinking') gazeTarget = { x: 3 + Math.random() * 2, y: -3 };
      else if (state === 'idle' && Math.random() < 0.6) gazeTarget = { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 3 };
      else gazeTarget = { x: (Math.random() - 0.5) * 1.6, y: 0 };
      nextGlance = now + 900 + Math.random() * 2600;
    }
    gaze.x += (gazeTarget.x - gaze.x) * 0.25;
    gaze.y += (gazeTarget.y - gaze.y) * 0.25;
    for (const id of ['pupil-l', 'pupil-r']) $(id).style.transform = `translate(${gaze.x}px, ${gaze.y}px)`;

    // Head: breathing, nods while talking, tilt while listening.
    const t = now / 1000;
    let rot = Math.sin(t * 0.6) * 0.8;
    let y = Math.sin(t * 1.3) * 1.2;
    if (state === 'listening') rot += 3;
    if (state === 'thinking') rot -= 2;
    if (talking) { y += Math.sin(t * 5.2) * 1.6; rot += Math.sin(t * 2.1) * 1.4; }
    $('head').style.transform = `translateY(${y}px) rotate(${rot}deg)`;
    $('body').style.transform = `translateY(${Math.sin(t * 1.3) * 0.6}px)`;

    // Brows: lift while listening, slight furrow while thinking, lively while talking.
    const lift = state === 'listening' ? -3.5 : state === 'thinking' ? 1.5 : talking ? -1.5 - Math.max(0, Math.sin(t * 3.1)) * 2 : 0;
    $('brow-l').style.transform = `translateY(${lift}px)`;
    $('brow-r').style.transform = `translateY(${state === 'thinking' ? lift - 3 : lift}px)`;

    requestAnimationFrame(frame);
  }

  const api = {
    start() {
      if (started || !$('ace-face')) return;
      started = true;
      requestAnimationFrame(frame);
    },
    setState(next) {
      state = next;
      const wrap = $('ace-face-wrap');
      if (wrap) wrap.dataset.state = next;
      nextGlance = 0;
    },
    // Called at the start of speech.
    startTalking() { talking = true; queue = []; lastWordAt = 0; },
    stopTalking() { talking = false; queue = []; target = SHAPES.smile; setTimeout(() => { if (!talking) target = SHAPES.rest; }, 700); },
    // Called on each spoken word (speechSynthesis boundary event): schedule mouth shapes across the word.
    word(text, rate = 1) {
      const now = performance.now();
      lastWordAt = now;
      const letters = text.toLowerCase().replace(/[^a-z0-9áéö']/g, '');
      const per = Math.max(45, 72 / rate);
      queue = [];
      [...letters].forEach((ch, i) => {
        if (ch === 'h' && i > 0) return;
        queue.push({ at: now + i * per, shape: shapeFor(ch, letters[i + 1]) });
      });
      queue.push({ at: now + letters.length * per + 30, shape: SHAPES.c });
    },
  };

  window.AceFace = api;
  document.addEventListener('DOMContentLoaded', () => { drawMouth(); api.start(); });
})();
