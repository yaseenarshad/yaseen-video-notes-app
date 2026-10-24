// Labs experiment "dense-mode": a transcript view that hides low-signal paragraphs (the analysis' paragraphScores
// below a threshold) behind thin "⋯ 12 min skipped (8 paragraphs) — show" rows that open in place.
// Hidden paragraphs are collapsed to zero height (not display: none), so the app's Follow keeps working: the current
// word of a hidden paragraph sits right under its row, which then says "you are here". Optional: skip hidden parts
// while playing. Nothing is rewritten — the shown paragraphs are the transcript as it is.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript;
  var ID = 'dense-mode', store = L.store(ID), WPM = 230, MIN_SKIP = 8;   // hidden parts shorter than 8 s are played, not jumped

  L.ui.css(ID, [
    '.p.dm-hid { height: 0; min-height: 0; padding-top: 0; padding-bottom: 0; margin-top: 0 !important; margin-bottom: 0 !important;',
    '  overflow: hidden; opacity: 0; pointer-events: none; }',
    '.p.dm-hid > * { font-size: 0 !important; line-height: 0 !important; }',
    '.p.dm-open { opacity: .62; } .p.dm-open.active, .p.dm-open:hover { opacity: 1; }',
    '.p.dm-open .t { box-shadow: inset -2px 0 0 var(--line); }',
    '.dm-row { display: flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; margin: 4px 0 4px 68px; padding: 2px 12px;',
    '  border: 1px dashed var(--faint); border-radius: 999px; font: 12.5px/1.6 system-ui, sans-serif; color: var(--muted); cursor: pointer;',
    '  user-select: none; -webkit-user-select: none; transition: background .2s, border-color .2s; }',
    '.dm-row:hover { color: var(--ink); border-color: var(--muted); }',
    '.dm-row a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }',
    '.dm-row.open { border-style: solid; border-color: var(--line); }',
    '.dm-row.here { border: 1.5px solid var(--hl-bar); background: var(--hl); color: var(--ink); font-weight: 600; }',
    '.dm-row.here::before { content: "▶"; color: var(--hl-bar); font-size: 10px; }',
    '.dm-strip { position: absolute; top: 9px; left: 14px; z-index: 4; display: flex; align-items: center; gap: 8px; white-space: nowrap;',
    '  flex-wrap: wrap; max-width: calc(100% - 130px); font: 12.5px system-ui, sans-serif; color: var(--muted);',
    '  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 4px 6px 4px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.08); }',
    '.dm-strip b { color: var(--ink); }',
    'body.finding .dm-strip { display: none !important; }',
    '.dm-strip .seg { display: flex; } .dm-strip .seg button { border-radius: 0; margin-left: -1px; }',
    '.dm-strip .seg button:first-child { border-radius: 999px 0 0 999px; } .dm-strip .seg button:last-child { border-radius: 0 999px 999px 0; }',
    '.dm-strip button { font: 600 12px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--muted);',
    '  padding: 2px 9px; border-radius: 999px; cursor: pointer; }',
    '.dm-strip button.on { background: var(--hl); color: var(--ink); border-color: var(--muted); }',
    '.dm-strip label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }',
    '.dm-strip .x { border: 0; background: transparent; font-size: 14px; padding: 0 4px; }',
  ].join('\n'));

  var S = { on: false, min: 2, skip: false };
  var A = null, runs = [], rows = [], hiddenRun = {}, strip = null, btn = null, lastSkipAt = 0, lastHere = -1;

  function human(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60);
  }
  function paraEnd(p) { return p + 1 < T.paragraphs.length ? T.paragraphs[p + 1].start : (L.video.duration() || T.duration || T.paragraphs[p].start + 30); }
  function hasNote(p) { var e = T.paraEl(p); return !!(e && e.querySelector('.note')); }

  // ---------- apply / clear ----------
  function clear() {
    rows.forEach(function (r) { r.remove(); });
    rows = []; runs = []; hiddenRun = {}; lastHere = -1;
    T.paragraphs.forEach(function (p) { var e = T.paraEl(p.index); if (e) e.classList.remove('dm-hid', 'dm-open'); });
  }
  function apply(keepOpen) {
    var open = {};
    if (keepOpen) runs.forEach(function (r) { if (r.open) open[r.a] = true; });
    clear();
    if (!S.on || !A) return stats();
    var scores = {}, chapterStart = {};
    A.paragraphScores.forEach(function (s) { scores[s.para] = s.score; });
    T.chapters.forEach(function (c) { if (typeof c.para === 'number') chapterStart[c.para] = true; });
    var cur = null;
    T.paragraphs.forEach(function (p) {
      var i = p.index, hide = (scores[i] === undefined ? 1 : scores[i]) < S.min && !hasNote(i);
      if (hide && cur && !chapterStart[i]) { cur.b = i; return; }
      if (cur) { runs.push(cur); cur = null; }
      if (hide) cur = { a: i, b: i };
    });
    if (cur) runs.push(cur);
    runs.forEach(function (r, k) {
      r.k = k; r.open = !!open[r.a]; r.t0 = T.paragraphs[r.a].start; r.t1 = paraEnd(r.b);
      r.n = r.b - r.a + 1;
      var row = el('div', { class: 'dm-row', title: 'Low-signal paragraphs (AI score below ' + S.min + '). Click to show / hide them here.' });
      row.addEventListener('click', function () { r.open = !r.open; paint(r); });
      row.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      T.paraEl(r.a).before(row);
      r.row = row; rows.push(row);
      for (var p = r.a; p <= r.b; p++) hiddenRun[p] = r;
      paint(r);
    });
    stats();
    L.log('dense-mode: min=' + S.min + ' runs=' + runs.length);
  }
  function paint(r) {
    for (var p = r.a; p <= r.b; p++) { var e = T.paraEl(p); e.classList.toggle('dm-hid', !r.open); e.classList.toggle('dm-open', r.open); }
    r.row.classList.toggle('open', r.open);
    var what = human(r.t1 - r.t0) + ' (' + r.n + ' paragraph' + (r.n > 1 ? 's' : '') + ')';
    r.row.textContent = '';
    if (r.open) r.row.append('▾ ' + what + ' of low-signal talk — ', el('a', {}, ['hide']));
    else if (r.here) r.row.append('You are here · ' + fmt(L.video.time()) + ' — inside ' + what + ' skipped — ', el('a', {}, ['show']));
    else r.row.append('⋯ ' + what + ' skipped — ', el('a', {}, ['show']));
  }

  // ---------- the strip over the transcript ----------
  function stats() {
    if (!strip) return;
    strip.style.display = S.on ? 'flex' : 'none';
    if (btn) btn.classList.toggle('on', S.on);
    if (!S.on) return;
    strip.textContent = '';
    if (!A) {
      strip.append(el('span', {}, ['▤ Dense mode needs an analysis — press 🧪 Analyze under the video.']),
        el('button', { class: 'x', title: 'Turn Dense mode off (⇧U)', onclick: function () { set({ on: false }); } }, ['✕']));
      return;
    }
    var all = 0, shown = 0, paras = 0, scores = {};
    A.paragraphScores.forEach(function (s) { scores[s.para] = s.score; });
    T.paragraphs.forEach(function (p) { all += p.words.length; if (!hiddenRun[p.index]) { shown += p.words.length; paras++; } });
    var seg = el('span', { class: 'seg' });
    [[3, '3 only', 'Only the densest paragraphs'], [2, '2+', 'Substantive and dense'], [1, '1+', 'Everything but filler']].forEach(function (o) {
      var n = T.paragraphs.filter(function (p) { var s = scores[p.index]; return (s === undefined ? 1 : s) >= o[0]; }).length;
      seg.append(el('button', { class: S.min === o[0] ? 'on' : '', title: o[2] + ' — ' + n + ' of ' + T.paragraphs.length + ' paragraphs',
        onclick: function () { set({ min: o[0] }); } }, [o[1]]));
    });
    var cb = el('input', { type: 'checkbox' }); cb.checked = S.skip;
    cb.addEventListener('change', function () { set({ skip: cb.checked }); });
    strip.append(el('b', {}, ['▤ Dense']), seg,
      el('span', { title: paras + ' of ' + T.paragraphs.length + ' paragraphs shown · ' + shown + ' of ' + all + ' words' },
        ['Reading time: ', el('b', {}, [Math.max(1, Math.round(shown / WPM)) + ' min']), ' instead of ' + Math.max(1, Math.round(all / WPM))]),
      el('label', { title: 'While the video plays, jump over the hidden parts (opened parts are played)' }, [cb, 'Skip hidden while playing']),
      el('button', { class: 'x', title: 'Turn Dense mode off (⇧U)', onclick: function () { set({ on: false }); } }, ['✕']));
  }
  function set(o) {
    var before = S.min, wasOn = S.on;
    Object.keys(o).forEach(function (k) { S[k] = o[k]; });
    store.set('prefs', S);
    if (o.on !== undefined || S.min !== before) apply(S.on && wasOn && S.min === before);
    else stats();
    if (o.on === true) L.ui.toast('▤ Dense mode: low-signal paragraphs hidden', 1600);
    if (o.on === false) L.ui.toast('Dense mode off — the full transcript', 1600);
  }

  // ---------- follow: "you are here" and the optional skip ----------
  L.video.onTick(function (s) {
    if (!S.on || !runs.length || s.para == null || s.para < 0) return;
    var r = hiddenRun[s.para], here = r && !r.open ? r.k : -1;
    if (here !== lastHere) {
      if (lastHere >= 0 && runs[lastHere]) { runs[lastHere].here = false; runs[lastHere].row.classList.remove('here'); paint(runs[lastHere]); }
      if (here >= 0) { r.here = true; r.row.classList.add('here'); }
      lastHere = here;
    }
    if (here >= 0) {
      paint(r);
      var m = L.mode.current();   // never skip while the reel or the sampler plays the video
      if (S.skip && !s.paused && m !== 'reel' && m !== 'sample' && r.t1 - r.t0 >= MIN_SKIP && performance.now() - lastSkipAt > 1500) {
        var to = r.b + 1 < T.paragraphs.length ? T.paragraphs[r.b + 1].start : null;
        if (to === null) return;
        var from = s.t;
        lastSkipAt = performance.now();
        L.video.seek(to + 0.35, { play: true });
        L.ui.actionToast('Skipped ' + human(to - from) + ' of low-signal talk', 'Undo', function () {
          r.open = true; paint(r); lastSkipAt = performance.now(); L.video.seek(from + 0.3, { play: true });
        });
        L.log('dense-mode: skipped ' + fmt(from) + ' → ' + fmt(to));
      }
    }
  }, 250);

  // ---------- entry points ----------
  btn = L.ui.addButton({ id: 'dmToggle', label: '▤ Dense', title: 'Dense mode: hide the low-signal paragraphs (⇧U)', onClick: function () { set({ on: !S.on }); } });
  L.ui.addKey('shift+u', function () { set({ on: !S.on }); }, 'Dense mode on / off (Labs)');
  var sc = T.scroller();
  if (sc && sc.parentNode) { strip = el('div', { class: 'dm-strip', style: { display: 'none' } }); sc.parentNode.appendChild(strip); }
  Promise.all([store.get('prefs'), L.analysis.get()]).then(function (r) {
    if (r[0]) Object.keys(S).forEach(function (k) { if (r[0][k] !== undefined) S[k] = r[0][k]; });
    A = r[1];
    // existing notes are rendered shortly after the page; wait a moment so their paragraphs are never hidden
    setTimeout(function () { apply(false); }, 800);
  });
  L.analysis.onChange(function (a) { A = a; apply(true); });
  window.LABS_denseMode = { set: set, state: function () { return { S: S, runs: runs.map(function (r) { return { a: r.a, b: r.b, open: r.open, here: !!r.here }; }) }; } };
})();
