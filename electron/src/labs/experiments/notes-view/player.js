// notes-view (Labs): the Transcript | Notes switch at the top of the transcript column. The Notes view itself (Milkdown
// + the vendored docs-app add-ons, view/index.ts) is a separate bundle, loaded only the first time Notes is shown, so the
// player stays as fast as before. The last choice is remembered per video (LABS.store). Switching lands on the same
// moment: the current time while Follow is on, else the time at the reading line of the view you leave.
(function () {
  'use strict';
  var L = window.LABS, ID = 'notes-view', vid = L.transcript.id, st = L.store(ID), el = L.ui.el;
  var scroller = L.transcript.scroller();
  if (!scroller) return;
  var wrap = scroller.parentNode;
  L.ui.css('notes-view-toggle', [
    '.nv-toggle { position: absolute; top: 10px; left: 16px; z-index: 5; display: flex; gap: 2px; padding: 2px; font: 13px system-ui, sans-serif;',
    '  background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }',
    '.nv-toggle button { border: 0; background: transparent; color: var(--muted); padding: 3px 11px; border-radius: 6px; cursor: pointer; font: inherit; }',
    '.nv-toggle button.on { background: var(--hl); color: var(--ink); font-weight: 600; }',
    '.find.show ~ .nv-toggle { display: none; }',
    'body.nv-notes-on #scroller { visibility: hidden; }',
    'body.nv-notes-on .rwrap > .tools { display: none; }',
  ].join('\n'));
  var bT = el('button', { title: 'The transcript (⇧T: switch)' }, ['Transcript']);
  var bN = el('button', { title: 'Notes part by part: 🤖 AI notes you can type into, slides, your 💬 notes (⇧T: switch)' }, ['Notes']);
  var tg = el('div', { class: 'nv-toggle' }, [bT, bN]);
  wrap.appendChild(tg);

  var mode = 'transcript', view = null, loading = null;

  function load() {
    if (!loading) loading = new Promise(function (resolve, reject) {
      var link = el('link', { rel: 'stylesheet', href: '/labs/x/notes-view/view.css' });
      document.head.appendChild(link);
      var s = el('script', { src: '/labs/x/notes-view/view.js' });
      s.onload = function () {
        try { view = window.__notesView.mount(L, wrap); resolve(view); } catch (e) { L.log('notes-view mount failed', String(e)); reject(e); }
      };
      s.onerror = function () { reject(new Error('could not load the Notes view')); };
      document.body.appendChild(s);
    });
    return loading;
  }

  // the time at the transcript's reading line (35 % down) — where a switch to Notes lands when Follow is off
  function transcriptTime() {
    var r = scroller.getBoundingClientRect(), line = r.top + r.height * 0.35, ps = L.transcript.paragraphs;
    var lo = 0, hi = ps.length - 1, p = 0;
    while (lo <= hi) { var m = (lo + hi) >> 1, e = L.transcript.paraEl(m); if (e && e.getBoundingClientRect().top <= line) { p = m; lo = m + 1; } else hi = m - 1; }
    var w = 0;
    for (var i = 0; i < ps[p].words.length; i++) { var we = L.transcript.wordEl(p, i); if (we && we.getBoundingClientRect().top <= line) w = i; else if (we) break; }
    return ps[p].times[w];
  }

  function paint() {
    bT.classList.toggle('on', mode === 'transcript'); bN.classList.toggle('on', mode === 'notes');
    document.body.classList.toggle('nv-notes-on', mode === 'notes');
  }

  function setMode(m, remember) {
    if (m === mode) return;
    if (m === 'notes') {
      var t = L.transcript.current().follow ? null : transcriptTime();
      mode = 'notes'; paint();
      load().then(function (v) { if (mode === 'notes') v.show(t); }).catch(function (e) { L.ui.toast('Notes view: ' + e.message, 5000); mode = 'transcript'; paint(); });
    } else {
      var at = view && view.visible() ? view.hide() : null;
      loadHints();   // the notes may have changed
      mode = 'transcript'; paint();
      if (L.transcript.current().follow) L.transcript.setFollow(true);   // back on the current word
      else if (at !== null) { var a = L.transcript.at(at); L.transcript.scrollTo(a.para, a.word); }
    }
    if (remember) st.set('view:' + vid, m);
  }
  // Name corrections in the notes (`Palmer Luckey <!-- was: Palmer Lucky -->`) → the same dotted underline on the
  // captions' spelling in the transcript, tooltip "Likely: Palmer Luckey (from the notes)". Display only: a class and a
  // title on the word elements; the transcript text and its .md never change.
  L.ui.css('notes-view-was', '.nv-was-hint { text-decoration: underline dotted; text-decoration-color: var(--muted); text-underline-offset: 3px; cursor: help; }');
  var hintMarks = [];
  function loadHints() {
    fetch('/labs/x/notes-view/hints', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) {
      hintMarks.forEach(function (m) { m.remove(); });
      hintMarks = (o.hints || []).map(function (h) {
        return L.transcript.highlightRange(h.span, { className: 'nv-was-hint', title: 'Likely: ' + h.name + ' (from the notes)' });
      });
    }).catch(function () { /* no notes file yet */ });
  }
  loadHints();

  // AI notes written in the background (automatically on open, or Write missing): a small chip under the toggle,
  // "🤖 Writing notes 4/12 · Codex · gpt-6.1-sol"; a usage limit is said once (the automatic jobs pause).
  L.ui.css('notes-view-job', '.nv-jobchip { position: absolute; top: 46px; left: 16px; z-index: 5; font: 12px system-ui, sans-serif; color: var(--muted); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; display: none; } .nv-jobchip.on { display: block; } .find.show ~ .nv-jobchip { display: none; }');
  var chip = el('div', { class: 'nv-jobchip' }, ['']);
  wrap.appendChild(chip);
  var saidPause = false, lastDone = -1;
  function jobTick() {
    fetch('/labs/x/notes-view/generate/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var on = j.state === 'running' || j.state === 'queued';
      chip.classList.toggle('on', on);
      if (on) chip.textContent = j.state === 'queued' ? '🤖 Notes waiting · ' + j.engine : '🤖 Writing notes ' + Math.min(j.done + 1, j.total) + '/' + j.total + ' · ' + j.engine;
      if (on && j.done !== lastDone) { lastDone = j.done; loadHints(); }
      if ((j.usageLimit || j.paused) && !saidPause) { saidPause = true; L.ui.toast(j.paused || j.error || 'AI usage limit reached — automatic AI notes are paused', 9000); }
    }).catch(function () { /* experiment off */ });
  }
  jobTick();
  setInterval(jobTick, 4000);

  bT.onclick = function () { setMode('transcript', true); };
  bN.onclick = function () { setMode('notes', true); };
  L.ui.addKey('shift+t', function () { setMode(mode === 'notes' ? 'transcript' : 'notes', true); }, 'Transcript / Notes (Labs)');

  st.get('view:' + vid).then(function (v) { if (v === 'notes') setMode('notes', false); });
  window.__notesViewToggle = { mode: function () { return mode; }, set: setMode };   // for tests (CDP)
})();
