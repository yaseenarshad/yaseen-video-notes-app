// Labs experiment "signal-strip": a slim vertical strip (a minimap of the whole video) along the transcript's right
// edge that shows where the good parts are. Two thin lanes, side by side, never blended (so you always know which
// source said what):
//   left lane  — YouTube's "most replayed" heatmap (orange), only when the video has one;
//   right lane — the AI paragraph score 0–3 (purple), bar length + darkness = score; the AI highlights are thin
//                accent ticks on its left edge.
// Hover = time + score + the paragraph's first words (verbatim, LABS.transcript.text); click = jump to that paragraph.
// The white line is the current position.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript;
  var SCORE_NAME = ['filler', 'ordinary', 'substantive', 'dense'];
  L.ui.css('signal-strip', [
    '.ss-rail { display: flex; gap: 2px; cursor: pointer; }',
    '.ss-lane { position: relative; flex: 1 1 0; height: 100%; border-radius: 3px; background: rgba(127,127,127,.10); overflow: hidden; }',
    '.ss-lane > i { position: absolute; left: 0; display: block; min-height: 1px; }',
    '.ss-heat > i { background: #e8590c; }',
    '.ss-ai > i { background: #7c5cff; }',
    '.ss-ai > i.ss-hl { left: 0; width: 2px !important; background: var(--accent); opacity: .95 !important; }',
    '.ss-none { position: absolute; inset: 0; background: repeating-linear-gradient(-45deg, rgba(127,127,127,.18) 0 3px, transparent 3px 7px); }',
    '.ss-now { position: absolute; left: -3px; right: -3px; height: 2px; background: var(--ink); box-shadow: 0 0 0 1px var(--bg); border-radius: 1px; pointer-events: none; z-index: 2; }',
    '.ss-tip { position: fixed; z-index: 20; max-width: 300px; font: 12.5px/1.4 system-ui, sans-serif; color: var(--ink); background: var(--panel);',
    '  border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); padding: 6px 9px; pointer-events: none; display: none; }',
    '.ss-tip b { font: 600 12px ui-monospace, monospace; color: var(--accent); }',
    '.ss-tip .ss-m { color: var(--muted); }',
    '.ss-tip q { display: block; margin-top: 3px; font-style: italic; }',
    '.ss-tip q::before { content: "“"; } .ss-tip q::after { content: "…”"; }',
  ].join('\n'));

  var paras = T.paragraphs;
  function dur() { return L.video.duration() || T.duration || (paras.length ? paras[paras.length - 1].start + 30 : 1); }
  function paraEnd(p) { return p + 1 < paras.length ? paras[p + 1].start : dur(); }
  function pct(t) { return Math.max(0, Math.min(100, t / dur() * 100)) + '%'; }
  function bar(t0, t1, width, opacity, cls) {
    return el('i', { class: cls || null, style: { top: pct(t0), height: 'calc(' + pct(t1 - t0) + ' + 0.5px)', width: width + '%', opacity: String(opacity) } });
  }

  var rail = L.ui.addRail('signal-strip', { width: 14 });
  var R = rail.el;
  R.classList.add('ss-rail');
  var now = el('div', { class: 'ss-now' });
  var tip = el('div', { class: 'ss-tip' });
  document.body.appendChild(tip);
  var state = { a: null, heat: null };

  function draw() {
    R.textContent = '';
    var lanes = [];
    if (state.heat) {
      var hl = el('div', { class: 'ss-lane ss-heat' });
      state.heat.forEach(function (p) { hl.appendChild(bar(p.start, p.end, 15 + 85 * p.value, 0.25 + 0.75 * p.value)); });
      lanes.push(hl);
    }
    var ai = el('div', { class: 'ss-lane ss-ai' });
    if (state.a) {
      // one bar per ~3 px of rail: the time-weighted mean score of that slice and its neighbours (a 581-paragraph
      // video would otherwise be 1 px of noise per paragraph); bar length + darkness = the score
      var sc = []; state.a.paragraphScores.forEach(function (s) { sc[s.para] = s.score; });
      var n = Math.max(40, Math.floor((R.clientHeight || 600) / 3)), d = dur(), bin = d / n, raw = [];
      for (var k = 0; k < n; k++) {
        var a0 = k * bin, a1 = a0 + bin, sum = 0, w = 0;
        for (var p = T.at(a0).para; p < paras.length && paras[p].start < a1; p++) {
          var o = Math.min(a1, paraEnd(p)) - Math.max(a0, paras[p].start);
          if (o > 0) { sum += o * (sc[p] === undefined ? 1 : sc[p]); w += o; }
        }
        raw.push(w ? sum / w : null);
      }
      raw.forEach(function (v, k) {
        if (v === null) return;
        var nb = [raw[k - 1], v, v, raw[k + 1]].filter(function (x) { return x !== null && x !== undefined; });
        var m = nb.reduce(function (x, y) { return x + y; }, 0) / nb.length, f = m / 3;
        ai.appendChild(bar(k * bin, (k + 1) * bin, 8 + 92 * f, 0.15 + 0.85 * f * f));
      });
      state.a.highlights.forEach(function (h) { ai.appendChild(bar(h.t0, h.t1, 0, 1, 'ss-hl')); });
    } else ai.appendChild(el('div', { class: 'ss-none' }));
    lanes.push(ai);
    lanes.forEach(function (x) { R.appendChild(x); });
    R.appendChild(now);
    rail.setWidth(lanes.length * 13 + (lanes.length - 1) * 2);
    tick();
  }

  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(draw, 300); });

  function tick() { now.style.top = 'calc(' + pct(L.video.time()) + ' - 1px)'; }
  L.video.onTick(tick, 500);

  function scoreOf(p) { var s = state.a && state.a.paragraphScores[p]; return s ? s.score : null; }
  function heatAt(t) {
    if (!state.heat) return null;
    for (var i = 0; i < state.heat.length; i++) if (t >= state.heat[i].start && t < state.heat[i].end) return state.heat[i].value;
    return null;
  }
  function timeAt(e) { var b = R.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) * dur(); }

  R.addEventListener('mousemove', function (e) {
    var t = timeAt(e), p = T.at(t).para, s = scoreOf(p), h = heatAt(t);
    var words = paras[p].words.length;
    tip.textContent = '';
    tip.append(el('b', {}, [fmt(paras[p].start)]),
      el('span', { class: 'ss-m' }, [
        (s !== null ? '  AI signal ' + s + '/3 (' + SCORE_NAME[s] + ')' : state.a ? '' : '  not analyzed') +
        (h !== null ? ' · replayed ' + Math.round(h * 100) + '%' : '')]),
      el('q', {}, [T.text({ startPara: p, startWord: 0, endPara: p, endWord: Math.min(words, 18) - 1 })]));
    tip.style.display = 'block';
    var tb = tip.getBoundingClientRect(), rb = R.getBoundingClientRect();
    tip.style.left = Math.max(8, rb.left - tb.width - 10) + 'px';
    tip.style.top = Math.max(8, Math.min(window.innerHeight - tb.height - 8, e.clientY - tb.height / 2)) + 'px';
  });
  R.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  R.addEventListener('mousedown', function (e) { e.preventDefault(); });
  R.addEventListener('click', function (e) {
    var p = T.at(timeAt(e)).para;
    L.video.seek(paras[p].start);
  });

  var tries = 0;
  function load() {
    Promise.all([L.analysis.get(), L.analysis.signals()]).then(function (r) {
      // signals not fetched yet (the app fetches them ~4 s after a video opens): look again a few times
      if (!r[1] && tries++ < 3) setTimeout(function () { L.analysis.refreshSignals(); load(); }, 10000);
      state.a = r[0];
      state.heat = r[1] && r[1].heatmap && r[1].heatmap.points && r[1].heatmap.points.length ? r[1].heatmap.points : null;
      draw();
      L.log('signal-strip: ' + (state.a ? state.a.paragraphScores.length + ' scores' : 'no analysis') + ', heatmap ' + (state.heat ? state.heat.length + ' points' : 'none'));
    });
  }
  load();
  L.analysis.onChange(function () { L.analysis.refreshSignals(); load(); });
})();
