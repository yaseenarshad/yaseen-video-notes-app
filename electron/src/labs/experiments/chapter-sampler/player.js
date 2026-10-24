// Labs experiment "chapter-sampler": "Sample" mode — plays the first N seconds (15/30/45/60, default 30) of every
// chapter back to back at the current speed. No chapters → 10-minute windows.
// Keys while sampling (LABS.ui.keyMode, so they win over the app's ←/→ seek and Esc):
//   → next sample · ← previous · Enter keep watching this chapter (sampling stops, playback goes on)
//   Esc stop and return to where you were before sampling · 1/2/3/4 sample length 15/30/45/60 s
// Shift+C (or the "▶ Sample" button) starts it. Seeking away yourself (a click in the transcript…) also stops it.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript, store = L.store('chapter-sampler');
  var LENS = [15, 30, 45, 60], WINDOW = 600;
  L.ui.css('chapter-sampler', [
    '.cs-chip { display: grid; grid-template-columns: auto auto; gap: 2px 10px; align-items: center; white-space: normal; max-width: 330px; background: rgba(0,0,0,.8); padding: 5px 9px; }',
    '.cs-chip b { font-weight: 600; }',
    '.cs-chip .cs-title { grid-column: 1 / -1; font-weight: 400; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.cs-chip .cs-btns { grid-column: 1 / -1; display: flex; gap: 4px; margin-top: 2px; }',
    '.cs-chip button { font: 600 11.5px system-ui, sans-serif; color: #fff; background: rgba(255,255,255,.16); border: 0; border-radius: 5px; padding: 1px 8px; cursor: pointer; }',
    '.cs-chip button:hover { background: rgba(255,255,255,.3); }',
    '.cs-chip .cs-left { font: 600 11.5px ui-monospace, monospace; opacity: .85; justify-self: end; }',
  ].join('\n'));

  var units = (T.chapters && T.chapters.length ? T.chapters.map(function (c, i) {
    return { start: c.start, end: c.end || (T.chapters[i + 1] ? T.chapters[i + 1].start : (L.video.duration() || T.duration)), title: c.title };
  }) : null);
  var kind = units ? 'Chapter' : 'Window';
  if (!units) {
    units = [];
    var d = L.video.duration() || T.duration || 0;
    for (var s = 0; s < d; s += WINDOW) units.push({ start: s, end: Math.min(d, s + WINDOW), title: fmt(s) + '–' + fmt(Math.min(d, s + WINDOW)) });
  }

  var len = 30, S = null;   // S: { i, end, seekedAt, before: { t, paused }, offKeys }
  store.get('len').then(function (v) { if (LENS.indexOf(v) >= 0) len = v; });

  var btn = L.ui.addButton({ id: 'chapterSample', label: '▶ Sample', title: 'Sample mode: the first ' + len + ' s of each ' + kind.toLowerCase() + ', back to back (Shift+C)' });
  var chip = L.ui.videoBadge('chapter-sampler');
  chip.classList.add('cs-chip');

  function unitAt(t) { var i = 0; for (var k = 0; k < units.length; k++) if (units[k].start <= t + 0.01) i = k; return i; }
  function go(i) {
    var u = units[i];
    S.i = i; S.end = Math.min(u.end, u.start + len); S.seekedAt = performance.now(); S.lastT = null;
    L.video.seek(u.start + 0.3, { play: true, follow: true });
    render();
  }
  // the chip is built once (so its buttons stay put); render() only updates its text
  var cTitle = el('span', { class: 'cs-title' }), cHead = el('b'), cLeft = el('span', { class: 'cs-left' }), cLen;
  function cbtn(label, title, fn) { var x = el('button', { title: title }, [label]); x.onmousedown = function (e) { e.preventDefault(); }; x.onclick = fn; return x; }
  cLen = cbtn('', 'Sample length — click to change (1/2/3/4 = 15/30/45/60 s)', function () { setLen(LENS[(LENS.indexOf(len) + 1) % LENS.length]); });
  chip.append(cHead, cLeft, cTitle, el('div', { class: 'cs-btns' }, [
    cbtn('◀', 'Previous (←)', function () { prev(); }), cbtn('▶', 'Next (→)', function () { next(); }), cLen,
    cbtn('Keep watching', 'Keep watching this ' + kind.toLowerCase() + ' (Enter)', function () { keep(); }), cbtn('✕', 'Stop and go back to where you were (Esc)', function () { escape(); })]));
  function render() {
    btn.textContent = S ? '■ Stop sampling' : '▶ Sample';
    btn.classList.toggle('on', !!S);
    chip.style.display = S ? '' : 'none';
    if (!S) return;
    var u = units[S.i];
    cHead.textContent = kind + ' ' + (S.i + 1) + '/' + units.length + ' · Sampling';
    cTitle.textContent = u.title; cTitle.title = u.title;
    cLeft.textContent = fmt(Math.max(0, S.end - L.video.time()));
    cLen.textContent = len + ' s';
  }
  function setLen(v) {
    len = v; store.set('len', v);
    if (S) { var u = units[S.i]; S.end = Math.min(u.end, u.start + len); render(); }
    L.ui.toast('Samples: ' + v + ' s', 1200);
  }
  function start() {
    if (S) return;
    if (!units.length) return L.ui.toast('Nothing to sample', 1500);
    var t = L.video.time(), i = unitAt(t);
    if (t - units[i].start > 5) i = (i + 1) % units.length;   // mid-chapter: start with the next one
    L.mode.enter('sample', function () { stop(); });   // one mode at a time: ends the reel / Read mode
    S = { before: { t: t, paused: L.video.paused() } };
    S.offKeys = L.ui.keyMode(function (k) {
      if (k === 'arrowright') { next(); return true; }
      if (k === 'arrowleft') { prev(); return true; }
      if (k === 'enter') { keep(); return true; }
      if (k === 'escape') { escape(); return true; }
      if (k === 'shift+c') { keep(); return true; }
      var n = ['1', '2', '3', '4'].indexOf(k); if (n >= 0) { setLen(LENS[n]); return true; }
      return false;
    });
    L.log('chapter-sampler: start at ' + kind + ' ' + (i + 1) + '/' + units.length + ', ' + len + ' s');
    go(i);
  }
  function stop(msg) {
    if (!S) return;
    S.offKeys(); S = null; render(); L.mode.exit('sample');
    if (msg) L.ui.toast(msg, 2200);
  }
  function next() {
    if (!S) return;
    if (S.i + 1 >= units.length) { L.video.pause(); return stop('Sampled all ' + units.length + ' ' + kind.toLowerCase() + 's'); }
    go(S.i + 1);
  }
  function prev() { if (S) go(Math.max(0, S.i - 1)); }
  function keep() { if (!S) return; var u = units[S.i]; stop('Watching ' + kind.toLowerCase() + ' ' + (S.i + 1) + ': ' + u.title); }
  function escape() {
    if (!S) return;
    var b = S.before; stop('Back to ' + fmt(b.t));
    L.video.seek(b.t + 0.3, { play: !b.paused, follow: true });
    if (b.paused) L.video.pause();
  }

  btn.onclick = function () { if (S) keep(); else start(); };
  L.ui.addKey('shift+c', function () { if (S) keep(); else start(); }, 'Chapter sampler: start / keep watching');

  L.video.onTick(function (st) {
    if (!S) return;
    render();
    // pushed forward inside this chapter (e.g. sponsor-skip jumped over a sponsor read at its start): sample from there
    var u = units[S.i], jumped = !st.paused && S.lastT != null && st.t - S.lastT > 6 && st.t > u.start && st.t < u.end - 5;
    S.lastT = st.t;
    if (jumped) { S.end = Math.min(u.end, st.t + len); S.seekedAt = performance.now(); return; }
    if (st.paused || performance.now() - S.seekedAt < 2500) return;
    if (st.t < u.start - 3) return stop('Sampling stopped (you moved)');
    if (st.t > S.end + 4) {   // pushed forward: by another experiment (e.g. a sponsor skip) → next; far away → you moved
      var nx = units[S.i + 1];
      return nx && st.t > nx.start + 5 ? stop('Sampling stopped (you moved)') : next();
    }
    if (st.t >= S.end - 0.15) next();
  }, 250);
  render();
})();
