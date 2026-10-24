// Labs experiment "coverage-map": what you actually HEARD vs skipped.
// - Heard = the video played continuously through it (any speed). A seek / skip / jump is not hearing: a tick only
//   counts when the time moved forward by about what the speed allows since the last tick.
// - Saved per video in Labs' userData (LABS.store('coverage-map'), key = the YouTube id) every 15 s while it changes,
//   and when the page goes away — so it survives relaunches. Never written to the vault.
// - Shown as: a rail along the transcript (heard = solid green, not heard = hollow), a dot per paragraph in the time
//   column (● heard, ◐ partly, ○ not), the line "Coverage 64% · 38 min not heard" on a button under the video, and a
//   ◐ Coverage panel tab listing the not-heard ranges (with their first words, verbatim); click = jump there.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript, store = L.store('coverage-map');
  var KEY = T.id, MIN_GAP = 10, SAVE_MS = 15000;
  L.ui.css('coverage-map', [
    '.cv-rail { border: 1.5px solid var(--muted); border-radius: 4px; overflow: hidden; cursor: pointer; opacity: .85; }',
    '.cv-rail > i { position: absolute; left: 0; right: 0; background: #2f9e6e; min-height: 1px; display: block; }',
    '.cv-rail .cv-now { position: absolute; left: -2px; right: -2px; height: 2px; background: var(--ink); box-shadow: 0 0 0 1px var(--bg); z-index: 2; }',
    '.cv-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid #2f9e6e; vertical-align: 0; opacity: .8; cursor: default; }',
    '.cv-dot.cv-h { background: #2f9e6e; }',
    '.cv-dot.cv-p { background: linear-gradient(90deg, #2f9e6e 50%, transparent 50%); }',
    '.cv-dot.cv-n { border-color: var(--faint); }',
    '.cv-head { position: sticky; top: -4px; z-index: 1; background: var(--panel); padding: 8px 10px; border-bottom: 1px solid var(--line); }',
    '.cv-head b { font-size: 15px; }',
    '.cv-head .cv-sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }',
    '.cv-head button { font: 12px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 1px 9px; cursor: pointer; margin-top: 6px; }',
    '.cv-bar { display: flex; height: 8px; border-radius: 3px; overflow: hidden; margin-top: 6px; border: 1px solid var(--line); position: relative; }',
    '.cv-bar > i { position: absolute; top: 0; bottom: 0; background: #2f9e6e; }',
    '.cv-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; border-bottom: 1px solid var(--line); }',
    '.cv-item:hover { background: var(--hl); }',
    '.cv-item .cv-t { font: 12px ui-monospace, monospace; color: var(--accent); }',
    '.cv-item .cv-len { font-size: 12px; color: var(--muted); margin-left: 6px; }',
    '.cv-item q { display: block; margin-top: 2px; font-style: italic; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.cv-item q::before { content: "“"; } .cv-item q::after { content: "…”"; }',
  ].join('\n'));

  var paras = T.paragraphs;
  function dur() { return L.video.duration() || T.duration || 1; }
  function paraEnd(p) { return p + 1 < paras.length ? paras[p + 1].start : dur(); }
  function pct(t) { return Math.max(0, Math.min(100, t / dur() * 100)) + '%'; }

  var heard = [];            // sorted, merged [start, end] pairs (seconds)
  var dirty = false, loaded = false;

  function add(a, b) {
    if (!(b > a)) return;
    var out = [], placed = false;
    for (var i = 0; i < heard.length; i++) {
      var h = heard[i];
      if (h[1] < a - 1) out.push(h);
      else if (h[0] > b + 1) { if (!placed) { out.push([a, b]); placed = true; } out.push(h); }
      else { a = Math.min(a, h[0]); b = Math.max(b, h[1]); }
    }
    if (!placed) out.push([a, b]);
    heard = out; dirty = true;
  }
  function heardIn(a, b) {
    var s = 0;
    for (var i = 0; i < heard.length; i++) { var o = Math.min(b, heard[i][1]) - Math.max(a, heard[i][0]); if (o > 0) s += o; }
    return s;
  }
  function gaps() {   // not-heard ranges ≥ MIN_GAP s
    var out = [], cur = 0, d = dur();
    heard.forEach(function (h) { if (h[0] - cur >= MIN_GAP) out.push([cur, h[0]]); cur = Math.max(cur, h[1]); });
    if (d - cur >= MIN_GAP) out.push([cur, d]);
    return out;
  }
  function human(s) {
    s = Math.round(s);
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function summary() {
    var d = dur(), h = Math.min(d, heardIn(0, d));
    return { pct: Math.round(h / d * 100), notHeard: Math.max(0, d - h) };
  }

  // ---- the rail ----
  var rail = L.ui.addRail('coverage-map', { width: 8 });
  var R = rail.el; R.classList.add('cv-rail');
  var nowLine = el('div', { class: 'cv-now' });
  R.addEventListener('mousedown', function (e) { e.preventDefault(); });
  R.addEventListener('click', function (e) { L.video.seek(paras[T.at(rail.timeAt(e.clientY)).para].start); });
  R.addEventListener('mousemove', function (e) {
    var t = rail.timeAt(e.clientY), inH = heard.some(function (h) { return t >= h[0] && t <= h[1]; });
    R.title = fmt(t) + (inH ? ' — heard' : ' — not heard') + '\n' + line();
  });
  function drawRail() {
    R.textContent = '';
    heard.forEach(function (h) { R.appendChild(el('i', { style: { top: pct(h[0]), height: pct(h[1] - h[0]) } })); });
    R.appendChild(nowLine);
    nowLine.style.top = 'calc(' + pct(L.video.time()) + ' - 1px)';
  }

  // ---- the time-column dots ----
  var gutter = T.addGutterLayer('coverage-map'), dots = [], dotState = [];
  function drawDots() {
    for (var p = 0; p < paras.length; p++) {
      var a = paras[p].start, b = paraEnd(p), f = b > a ? heardIn(a, b) / (b - a) : 0;
      var s = f >= 0.8 ? 'cv-h' : f >= 0.2 ? 'cv-p' : 'cv-n';
      if (dotState[p] === s) continue;
      dotState[p] = s;
      if (!dots[p]) dots[p] = gutter.set(p, el('i', { class: 'cv-dot' }), { title: '' });
      if (dots[p]) { dots[p].firstChild.className = 'cv-dot ' + s; dots[p].title = s === 'cv-h' ? 'Heard' : s === 'cv-p' ? 'Partly heard' : 'Not heard yet'; }
    }
  }

  // ---- the line + the panel tab ----
  function line() { var s = summary(); return 'Coverage ' + s.pct + '% · ' + human(s.notHeard) + ' not heard'; }
  var btn = L.ui.addButton({ id: 'coverageBtn', label: '◐ …', title: 'What you have heard of this video (Labs) — click for the not-heard parts' });
  var tab = L.transcript.addPanelTab('coverage-map', '◐ Coverage', renderTab);
  btn.onclick = function () { tab.show(); };
  function renderTab(box) {
    box.textContent = '';
    var s = summary(), g = gaps();
    var bar = el('div', { class: 'cv-bar', title: 'green = heard' });
    heard.forEach(function (h) { bar.appendChild(el('i', { style: { left: pct(h[0]), width: pct(h[1] - h[0]) } })); });
    var reset = el('button', { title: 'Forget what you heard of this video' }, ['Reset']);
    reset.onclick = function () { L.ui.actionToast('Forget the coverage of this video?', 'Reset', function () { heard = []; dirty = true; save(); redraw(); }); };
    box.appendChild(el('div', { class: 'cv-head' }, [
      el('b', {}, [line()]),
      el('div', { class: 'cv-sub' }, [g.length ? g.length + ' part' + (g.length > 1 ? 's' : '') + ' not heard (≥ ' + MIN_GAP + ' s) — click one to go there' : 'You have heard all of it.']),
      bar, reset]));
    g.forEach(function (x) {
      var a = T.at(x[0]), p = a.para, w = a.word, words = paras[p].words.length;
      var span = { startPara: p, startWord: w, endPara: p, endWord: Math.min(words - 1, w + 13) };
      var it = el('div', { class: 'cv-item' }, [
        el('span', { class: 'cv-t' }, [fmt(x[0]) + '–' + fmt(x[1])]),
        el('span', { class: 'cv-len' }, [human(x[1] - x[0])]),
        el('q', {}, [T.text(span)])]);
      it.onclick = function () { L.video.seek(x[0]); };
      box.appendChild(it);
    });
  }

  function redraw() {
    drawRail(); drawDots();
    btn.textContent = '◐ ' + summary().pct + '%';
    btn.title = line() + ' — click for the not-heard parts';
    var l = line() + '|' + gaps().length;
    if (l !== lastLine) { lastLine = l; tab.refresh(); }   // only while the tab is shown (and only when it changed)
  }
  var lastLine = '';

  // ---- tracking ----
  var prev = null, lastDraw = 0;
  L.video.onTick(function (st) {
    var now = performance.now();
    nowLine.style.top = 'calc(' + pct(st.t) + ' - 1px)';
    if (!loaded) return;
    if (st.paused) { prev = null; return; }
    if (prev) {
      var dt = st.t - prev.t, dw = (now - prev.wall) / 1000;
      if (dt > 0 && dt <= dw * Math.max(st.rate || 1, 0.25) * 1.6 + 0.75) add(prev.t, st.t);
    }
    prev = { t: st.t, wall: now };
    if (dirty && now - lastDraw > 2000) { lastDraw = now; redraw(); }
  }, 500);

  function save() {
    if (!dirty || !loaded) return;
    dirty = false;
    var round = heard.filter(function (h) { return h[1] - h[0] >= 0.5; })
      .map(function (h) { return [Math.round(h[0] * 10) / 10, Math.round(h[1] * 10) / 10]; });
    store.set(KEY, { heard: round, duration: dur(), updatedAt: new Date().toISOString() });
  }
  setInterval(save, SAVE_MS);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  store.get(KEY).then(function (v) {
    if (v && Array.isArray(v.heard)) v.heard.forEach(function (h) { if (Array.isArray(h)) add(+h[0], +h[1]); });
    dirty = false; loaded = true; redraw();
    L.log('coverage-map: ' + line());
  }, function () { loaded = true; redraw(); });
})();
