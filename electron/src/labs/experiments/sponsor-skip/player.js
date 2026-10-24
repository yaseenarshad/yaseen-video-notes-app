// Labs experiment "sponsor-skip": skips SponsorBlock segments while the video plays.
// - Segments come from LABS.analysis.signals() (fetched by the app in the background when a video opens).
// - Entering an enabled segment while playing → jump to its end + "Skipped sponsor (0:42) · Undo" (Undo goes back to
//   the segment's start and never skips that one again this session).
// - The time column shows ⏭ at each segment's first paragraph; the segment's words are struck through faintly.
// - "⏭ Skip" under the video: per-category switches (saved with LABS.store) and the list of segments.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript, store = L.store('sponsor-skip');
  var CATS = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro'];
  var NAME = { sponsor: 'sponsor', selfpromo: 'self-promo', interaction: 'interaction reminder', intro: 'intro', outro: 'outro' };
  L.ui.css('sponsor-skip', [
    '.sk-seg { text-decoration: line-through; text-decoration-color: rgba(127,127,127,.55); opacity: .55; }',
    '.sk-mark { cursor: pointer; font-size: 12px; }',
    '.sk-mark.off { opacity: .35; }',
    '.sk-pop { position: fixed; z-index: 30; width: 290px; font: 13px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--panel);',
    '  border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.22); padding: 10px 12px; display: none; }',
    '.sk-pop.show { display: block; }',
    '.sk-pop h4 { margin: 0 0 6px; font: 600 12px system-ui, sans-serif; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }',
    '.sk-pop label { display: flex; align-items: center; gap: 8px; padding: 2px 0; cursor: pointer; }',
    '.sk-pop label span:last-child { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }',
    '.sk-pop .sk-list { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 6px; max-height: 220px; overflow: auto; }',
    '.sk-pop .sk-row { display: flex; gap: 8px; padding: 2px 4px; border-radius: 5px; cursor: pointer; }',
    '.sk-pop .sk-row:hover { background: var(--hl); }',
    '.sk-pop .sk-row b { font: 12px ui-monospace, monospace; color: var(--accent); font-weight: 400; }',
    '.sk-pop .sk-row.off { opacity: .5; }',
    '.sk-pop .sk-note { color: var(--muted); font-size: 12px; margin-top: 6px; }',
  ].join('\n'));

  var on = {}; CATS.forEach(function (c) { on[c] = true; });
  var segs = [];             // { category, start, end, i }
  var allowed = {};          // segment index → true (Undo / clicked: never skip it this session)
  var skipped = 0;
  var gutter = T.addGutterLayer('sponsor-skip');
  var marks = [];

  var btn = L.ui.addButton({ id: 'sponsorSkip', label: '⏭ Skip …', title: 'SponsorBlock auto-skip (Labs) — click for categories' });
  var pop = el('div', { class: 'sk-pop' });
  document.body.appendChild(pop);
  btn.onclick = function (e) {
    e.stopPropagation();
    if (pop.classList.contains('show')) return pop.classList.remove('show');
    renderPop();
    var b = btn.getBoundingClientRect();
    pop.classList.add('show');
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, b.left)) + 'px';
    pop.style.top = (b.bottom + 6 + pop.offsetHeight > window.innerHeight ? b.top - pop.offsetHeight - 6 : b.bottom + 6) + 'px';
  };
  document.addEventListener('mousedown', function (e) { if (!pop.contains(e.target) && e.target !== btn) pop.classList.remove('show'); });

  function len(s) { return fmt(Math.max(1, Math.round(s.end - s.start))); }
  function enabledCount() { return segs.filter(function (s) { return on[s.category]; }).length; }
  function updateBtn() {
    btn.textContent = segs.length ? '⏭ Skip ' + enabledCount() + '/' + segs.length : '⏭ Skip: none';
    btn.classList.toggle('on', enabledCount() > 0);
    btn.title = segs.length ? 'SponsorBlock: ' + segs.length + ' segment(s), ' + enabledCount() + ' set to auto-skip' + (skipped ? ', ' + skipped + ' skipped so far' : '') + '. Click for categories.'
      : 'SponsorBlock has no segments for this video.';
  }

  function renderPop() {
    pop.textContent = '';
    pop.appendChild(el('h4', {}, ['Auto-skip (SponsorBlock)']));
    CATS.forEach(function (c) {
      var n = segs.filter(function (s) { return s.category === c; }).length;
      var cb = el('input', { type: 'checkbox' }); cb.checked = !!on[c];
      cb.onchange = function () { on[c] = cb.checked; store.set('categories', on); drawMarks(); updateBtn(); renderPop(); };
      pop.appendChild(el('label', {}, [cb, el('span', {}, [NAME[c]]), el('span', {}, [n ? String(n) : '–'])]));
    });
    var list = el('div', { class: 'sk-list' });
    if (!segs.length) list.appendChild(el('div', { class: 'sk-note' }, ['No SponsorBlock segments for this video.']));
    segs.forEach(function (s) {
      var r = el('div', { class: 'sk-row' + (on[s.category] && !allowed[s.i] ? '' : ' off'), title: 'Click to watch this segment (it will not be skipped)' },
        [el('b', {}, [fmt(s.start) + '–' + fmt(s.end)]), el('span', {}, [NAME[s.category] + ' · ' + len(s)])]);
      r.onclick = function () { watch(s); pop.classList.remove('show'); };
      list.appendChild(r);
    });
    pop.appendChild(list);
    pop.appendChild(el('div', { class: 'sk-note' }, ['Segments are community-submitted (sponsor.ajay.app). Saved for every video.']));
  }

  function watch(s) { allowed[s.i] = true; drawMarks(); L.video.seek(s.start); }

  function drawMarks() {
    gutter.clear();
    marks.forEach(function (m) { m.remove(); }); marks = [];
    segs.forEach(function (s) {
      var a = T.at(s.start), b = T.at(Math.max(s.start, s.end - 0.05));
      var live = on[s.category] && !allowed[s.i];
      var m = gutter.set(a.para, '⏭', {
        title: NAME[s.category] + ' ' + fmt(s.start) + '–' + fmt(s.end) + ' (' + len(s) + ')' +
          (live ? ' — auto-skipped. Click to watch it.' : allowed[s.i] ? ' — you chose to watch it' : ' — not skipped (category off)'),
        onClick: function () { watch(s); },
      });
      if (m) m.className = 'sk-mark' + (live ? '' : ' off');
      if (live) marks.push(T.highlightRange({ startPara: a.para, startWord: a.word, endPara: b.para, endWord: b.word },
        { className: 'sk-seg', title: NAME[s.category] + ' (SponsorBlock) — skipped' }));
    });
  }

  L.video.onTick(function (st) {
    if (st.paused || !segs.length || L.mode.current() === 'reel') return;   // the reel plays only the AI highlights
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!on[s.category] || allowed[s.i]) continue;
      if (st.t >= s.start && st.t < s.end - 0.5) {
        skipped++;
        L.video.seek(s.end + 0.3, { play: true, follow: true });
        L.log('sponsor-skip: skipped ' + s.category + ' ' + s.start + '–' + s.end);
        L.ui.actionToast('Skipped ' + NAME[s.category] + ' (' + len(s) + ')', 'Undo', function () { watch(s); });
        updateBtn();
        return;
      }
    }
  }, 250);

  var tries = 0;
  function load() {
    Promise.all([store.get('categories'), tries ? L.analysis.refreshSignals() : L.analysis.signals()]).then(function (r) {
      if (r[0] && typeof r[0] === 'object') CATS.forEach(function (c) { if (typeof r[0][c] === 'boolean') on[c] = r[0][c]; });
      var sb = r[1] && r[1].sponsorblock;
      // not fetched yet (the app fetches signals ~4 s after a video opens): look again a few times
      if (!sb && tries++ < 4) setTimeout(load, 8000);
      segs = (sb && sb.segments || []).filter(function (s) { return CATS.indexOf(s.category) >= 0 && s.end > s.start; })
        .map(function (s, i) { return { category: s.category, start: s.start, end: s.end, i: i }; });
      drawMarks(); updateBtn();
      L.log('sponsor-skip: ' + segs.length + ' segments');
    });
  }
  load();
})();
