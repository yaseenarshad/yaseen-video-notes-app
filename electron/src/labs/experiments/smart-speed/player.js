// Labs experiment "smart-speed": automatic speed by the AI paragraph score (labs-analysis.json paragraphScores).
//   score 0–1 (filler / ordinary) → "skim" speed (default 3.5×) · score 3 (dense) → "listen" speed (default: your speed
//   when you first turn it on) · score 2 → in between.
// Smooth, never thrashing:
//   - the score is averaged over a window of the video [t − 5 s, t + 20 s] (weighted by time), so one short paragraph
//     does not move the speed, and the speed starts rising/falling a little BEFORE a stretch begins;
//   - the result is quantized to 5 levels (listen, +¼, +½, +¾ of the way, skim);
//   - a new level must hold for 2 s and at least 8 s must pass since the last change;
//   - changes ramp in 0.25× steps (one every 350 ms) instead of jumping.
// A manual speed change (S / D / R / G) pauses it for 30 s. Toggle: A, or "⚡ Smart" under the video.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript, store = L.store('smart-speed');
  var WIN_BACK = 5, WIN_AHEAD = 20, HOLD_MS = 2000, GAP_MS = 8000, MANUAL_MS = 30000, STEP = 0.25, STEP_MS = 350;
  L.ui.css('smart-speed', [
    '.sm-badge { cursor: pointer; }',
    '.sm-badge.paused { background: rgba(120,60,0,.75); }',
    '.sm-pop { position: fixed; z-index: 30; width: 270px; font: 13px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--panel);',
    '  border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.22); padding: 10px 12px; display: none; }',
    '.sm-pop.show { display: block; }',
    '.sm-pop h4 { margin: 0 0 8px; font: 600 12px system-ui, sans-serif; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; display: flex; justify-content: space-between; align-items: center; }',
    '.sm-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }',
    '.sm-row > span:first-child { flex: 1; }',
    '.sm-row button { font: 600 12px system-ui, sans-serif; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 6px; padding: 1px 8px; cursor: pointer; }',
    '.sm-row b { font: 600 12.5px ui-monospace, monospace; min-width: 44px; text-align: center; }',
    '.sm-pop .sm-on { font: 600 12px system-ui, sans-serif; border-radius: 999px; padding: 2px 10px; cursor: pointer; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }',
    '.sm-pop .sm-on.on { background: #7c5cff; border-color: #7c5cff; color: #fff; }',
    '.sm-note { color: var(--muted); font-size: 12px; margin-top: 6px; }',
  ].join('\n'));

  var cfg = { on: false, skim: 3.5, listen: null, lastApplied: null };   // lastApplied: the speed smart mode left the video at
  var scores = null;                      // paragraph → 0..3
  var applied = null;                     // the speed smart mode set last (null: none / given back to the user)
  var cand = null, candSince = 0, lastChange = 0, manualUntil = 0, rampTimer = null, rampTo = null;
  var paras = T.paragraphs;

  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var fx = function (x) { return String(r2(x)).replace(/\.0+$/, '') + '×'; };
  function dur() { return L.video.duration() || T.duration || 1; }
  function paraEnd(p) { return p + 1 < paras.length ? paras[p + 1].start : dur(); }
  function listen() { return cfg.listen || L.video.speed(); }

  // ---- the target speed ----
  function smoothScore(t) {
    var a = Math.max(0, t - WIN_BACK), b = t + WIN_AHEAD, p = T.at(a).para, sum = 0, w = 0;
    for (; p < paras.length && paras[p].start < b; p++) {
      var o = Math.min(b, paraEnd(p)) - Math.max(a, paras[p].start);
      if (o > 0) { sum += o * (scores[p] === undefined ? 1 : scores[p]); w += o; }
    }
    return w ? sum / w : 1;
  }
  function targetFor(t) {
    var s = smoothScore(t), frac = Math.max(0, Math.min(1, (2.75 - s) / 1.75));   // ≤ 1 → skim, ≥ 2.75 → listen
    frac = Math.round(frac * 4) / 4;
    return r2(listen() + frac * (cfg.skim - listen()));
  }
  function why(p) {
    var s = scores ? scores[p] : null;
    return s === null || s === undefined ? '' : s <= 1 ? 'low signal' : s === 2 ? 'substantive' : 'dense';
  }

  // ---- applying it: a ramp of 0.25× steps ----
  function rampTowards(to) {
    rampTo = to; clearTimeout(rampTimer);
    (function step() {
      var cur = applied === null ? L.video.speed() : applied;
      if (Math.abs(cur - rampTo) < 0.001) { rampTimer = null; cfg.lastApplied = applied; save(); return; }
      var next = r2(cur < rampTo ? Math.min(rampTo, cur + STEP) : Math.max(rampTo, cur - STEP));
      applied = next; L.video.setRate(next);
      rampTimer = setTimeout(step, STEP_MS);
    })();
  }
  function stopRamp() { clearTimeout(rampTimer); rampTimer = null; rampTo = null; }

  // ---- UI ----
  var badge = L.ui.videoBadge('smart-speed');
  badge.classList.add('sm-badge');
  badge.title = 'Smart speed (Labs) — click for settings, A to turn off';
  var btn = L.ui.addButton({ id: 'smartSpeed', label: '⚡ Smart', title: 'Smart speed: skim low-signal stretches, slow down for dense ones (A)' });
  var pop = el('div', { class: 'sm-pop' });
  document.body.appendChild(pop);
  function openPop(anchor) {
    if (pop.classList.contains('show')) return pop.classList.remove('show');
    renderPop(); pop.classList.add('show');
    var b = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, b.left)) + 'px';
    pop.style.top = (b.bottom + 6 + pop.offsetHeight > window.innerHeight ? b.top - pop.offsetHeight - 6 : b.bottom + 6) + 'px';
  }
  btn.onclick = function (e) { e.stopPropagation(); openPop(btn); };
  badge.onclick = function (e) { e.stopPropagation(); openPop(badge); };
  document.addEventListener('mousedown', function (e) { if (!pop.contains(e.target) && e.target !== btn && e.target !== badge) pop.classList.remove('show'); });

  function renderPop() {
    pop.textContent = '';
    var tg = el('button', { class: 'sm-on' + (cfg.on ? ' on' : '') }, [cfg.on ? 'On' : 'Off']);
    tg.onclick = function () { toggle(); renderPop(); };
    pop.appendChild(el('h4', {}, ['Smart speed', tg]));
    function row(label, get, set, extra) {
      var minus = el('button', {}, ['−']), plus = el('button', {}, ['+']);
      minus.onclick = function () { set(r2(Math.max(0.5, get() - STEP))); renderPop(); };
      plus.onclick = function () { set(r2(Math.min(16, get() + STEP))); renderPop(); };
      pop.appendChild(el('div', { class: 'sm-row' }, [el('span', {}, [label]), minus, el('b', {}, [fx(get())]), plus].concat(extra || [])));
    }
    row('Skim (score 0–1)', function () { return cfg.skim; }, function (v) { cfg.skim = v; save(); kick(); });
    var mine = el('button', { title: 'Use the speed the video plays at right now' }, ['now']);
    mine.onclick = function () { cfg.listen = r2(L.video.speed()); save(); kick(); renderPop(); };
    row('Listen (score 3)', listen, function (v) { cfg.listen = v; save(); kick(); }, [mine]);
    pop.appendChild(el('div', { class: 'sm-note' }, [
      scores ? 'Score 2 plays halfway between. It looks ~20 s ahead and changes at most every 8 s. S / D pauses it for 30 s.'
        : 'This video is not analyzed yet — press 🧪 Analyze first.']));
  }
  function save() { store.set('cfg', cfg); }
  function kick() { cand = null; lastChange = 0; }

  function toggle() {
    cfg.on = !cfg.on;
    if (cfg.on) {
      if (!cfg.listen) cfg.listen = r2(L.video.speed());
      manualUntil = 0; kick();
      L.ui.toast(scores ? 'Smart speed on · skim ' + fx(cfg.skim) + ' · listen ' + fx(cfg.listen) : 'Smart speed on — needs the analysis (🧪 Analyze)', 2200);
    } else {
      stopRamp();
      if (applied !== null && Math.abs(L.video.speed() - applied) < 0.001) L.video.setRate(listen());   // give the user's speed back
      applied = null; cfg.lastApplied = null;
      L.ui.toast('Smart speed off', 1500);
    }
    save(); show();
    L.log('smart-speed: ' + (cfg.on ? 'on' : 'off'));
  }
  L.ui.addKey('a', toggle, 'Smart speed on / off');

  var lastWhy = '';
  function show(extra) {
    btn.classList.toggle('on', cfg.on);
    btn.textContent = cfg.on ? '⚡ Smart: on' : '⚡ Smart';
    badge.classList.toggle('paused', !!extra);
    if (!cfg.on) { badge.textContent = ''; return; }
    if (!scores) { badge.textContent = 'Smart: analyze first'; return; }
    badge.textContent = extra || 'Smart ' + fx(L.video.speed()) + (lastWhy ? ' (' + lastWhy + ')' : '');
  }

  L.video.onTick(function (st) {
    if (!cfg.on || !scores) return show();
    var now = performance.now(), sp = L.video.speed();
    // a speed we did not set → the user pressed S / D / R / G: hands off for 30 s
    if (applied !== null && Math.abs(sp - applied) > 0.001) {
      stopRamp(); applied = null; manualUntil = now + MANUAL_MS;
      L.ui.toast('Smart speed paused for 30 s (you changed the speed)', 2000);
      L.log('smart-speed: manual change to ' + sp + ', paused 30 s');
    }
    if (now < manualUntil) return show('Smart paused · ' + Math.ceil((manualUntil - now) / 1000) + ' s');
    if (manualUntil) { manualUntil = 0; kick(); }
    lastWhy = why(st.para);
    show();
    if (st.paused || rampTimer) return;
    var want = targetFor(st.t);
    var cur = applied === null ? sp : applied;
    if (Math.abs(want - cur) < 0.001) { cand = null; return; }
    if (cand !== want) { cand = want; candSince = now; return; }
    if (now - candSince < HOLD_MS || (lastChange && now - lastChange < GAP_MS)) return;
    lastChange = now; cand = null;
    L.log('smart-speed: ' + fx(cur) + ' → ' + fx(want) + ' at ' + fmt(st.t) + ' (' + lastWhy + ')');
    rampTowards(want);
  }, 250);

  // leaving the video at the skim speed would keep it as the saved speed: give the listen speed back
  window.addEventListener('pagehide', function () { if (cfg.on && applied !== null && Math.abs(L.video.speed() - applied) < 0.001) L.video.setRate(listen()); });

  function load() {
    L.analysis.get().then(function (a) {
      scores = null;
      if (a && a.paragraphScores) { scores = []; a.paragraphScores.forEach(function (s) { scores[s.para] = s.score; }); }
      show();
    });
  }
  store.get('cfg').then(function (c) {
    if (c && typeof c === 'object') {
      if (typeof c.skim === 'number') cfg.skim = c.skim;
      if (typeof c.listen === 'number') cfg.listen = c.listen;
      cfg.on = !!c.on;
      // the saved speed is still the one smart mode set last time (e.g. 3.5× skim) → it is ours to give back
      if (typeof c.lastApplied === 'number' && Math.abs(L.video.speed() - c.lastApplied) < 0.001) applied = cfg.lastApplied = c.lastApplied;
    }
    load(); show();
  });
  L.analysis.onChange(load);
})();
