// Labs experiment "analysis-inspector": a 🧪 Analysis panel tab that lists the raw analysis. The example of the
// pattern: everything goes through window.LABS (src/labs/page/api.js); the verbatim text of every item comes from
// LABS.transcript.text(span), never from the model; AI labels are shown with LABS.ui.label().
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt;
  L.ui.css('analysis-inspector', [
    '.ai-head { padding: 6px 8px 8px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); }',
    '.ai-head b { color: var(--ink); font-weight: 600; }',
    '.ai-head button, .ai-chips button { font: 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer; margin: 4px 4px 0 0; }',
    '.ai-chips { position: sticky; top: -4px; z-index: 1; background: var(--panel); padding: 4px 4px 6px; border-bottom: 1px solid var(--line); }',
    '.ai-chips button.on { background: var(--hl); border-color: var(--muted); font-weight: 600; }',
    '.ai-strip { display: flex; height: 10px; margin-top: 6px; border-radius: 3px; overflow: hidden; cursor: pointer; }',
    '.ai-strip span { flex: 1; }',
    '.ai-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; border-bottom: 1px solid var(--line); }',
    '.ai-item:hover { background: var(--hl); }',
    '.ai-t { font: 12px ui-monospace, monospace; color: var(--accent); margin-right: 6px; }',
    '.ai-meta { font-size: 11.5px; color: var(--muted); margin-left: 6px; }',
    '.ai-q { display: block; margin-top: 3px; font-style: italic; color: var(--ink); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }',
    '.ai-a { display: block; margin-top: 2px; font-size: 12.5px; color: var(--muted); }',
    '.ai-repair { font: 11.5px ui-monospace, monospace; color: var(--muted); padding: 2px 8px; }',
    '.ai-sig { margin-top: 4px; }',
    '.ai-sig a { color: var(--accent); cursor: pointer; margin-right: 6px; }',
  ].join('\n'));

  var tab = 'highlights', hover = null, running = null;
  var SHADE = ['rgba(127,127,127,.15)', 'rgba(124,92,255,.25)', 'rgba(124,92,255,.5)', 'rgba(124,92,255,.85)'];

  function quote(span) { var t = L.transcript.text(span); return '“' + t + '”'; }
  function item(span, top, below, onEnter) {
    var it = el('div', { class: 'ai-item' }, [
      el('span', { class: 'ai-t' }, [fmt(span.t0) + '–' + fmt(span.t1)]),
    ].concat(top || []).concat([el('span', { class: 'ai-q' }, [quote(span)])]).concat(below || []));
    it.onclick = function () { L.video.seek(span.t0); };
    it.onmouseenter = function () { if (hover) hover.remove(); hover = L.transcript.highlightRange(span); if (onEnter) onEnter(); };
    it.onmouseleave = function () { if (hover) { hover.remove(); hover = null; } };
    return it;
  }
  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  function render(box) {
    box.textContent = '';
    Promise.all([L.analysis.get(), L.analysis.status(), L.analysis.signals()]).then(function (r) {
      var a = r[0], st = r[1], sig = r[2];
      box.textContent = '';
      var head = el('div', { class: 'ai-head' });
      box.appendChild(head);
      if (st.state === 'running') {
        head.append('Analyzing… started ' + new Date(st.startedAt).toLocaleTimeString() + (st.lines.length ? ' — ' + st.lines[st.lines.length - 1] : ''));
        clearTimeout(running); running = setTimeout(function () { tabApi.refresh(); }, 2000);
        return;
      }
      if (!a) {
        head.append(st.state === 'failed' ? 'The last analysis failed: ' + st.error : 'Not analyzed yet.');
        head.append(el('br'), el('button', { onclick: function () { L.analysis.run({}).then(function () { tabApi.refresh(); }); } }, ['🧪 Analyze this video']));
        signals(head, sig);
        return;
      }
      head.append(el('b', {}, [a.highlights.length + ' highlights']), ' · ' + a.pullQuotes.length + ' quotes · ' + a.questions.length + ' questions · ' +
        a.claims.length + ' claims · ' + a.mochiCandidates.length + ' flashcards', el('br'),
        'Analyzed ' + new Date(a.createdAt).toLocaleString() + ' (' + a.source + ', ' + Math.round(a.elapsedMs / 1000) + ' s, ' + a.chunks + ' call' + (a.chunks > 1 ? 's' : '') + ')',
        el('button', { title: 'Run the analysis again (replaces this one)', onclick: function () { L.analysis.run({ force: true }).then(function () { tabApi.refresh(); }); } }, ['Run again']));
      // signal density per paragraph (0–3), click to jump
      var strip = el('div', { class: 'ai-strip', title: 'Signal density per paragraph (darker = denser). Click to jump.' });
      a.paragraphScores.forEach(function (s) { strip.appendChild(el('span', { style: { background: SHADE[s.score] || SHADE[1] } })); });
      strip.onclick = function (e) {
        var r2 = strip.getBoundingClientRect(), p = Math.floor((e.clientX - r2.left) / r2.width * a.paragraphScores.length);
        var para = L.transcript.paragraphs[Math.max(0, Math.min(p, L.transcript.paragraphs.length - 1))];
        L.video.seek(para.start);
      };
      head.appendChild(strip);
      signals(head, sig);

      var chips = el('div', { class: 'ai-chips' });
      [['highlights', 'Highlights', a.highlights.length], ['quotes', 'Pull quotes', a.pullQuotes.length], ['questions', 'Questions', a.questions.length],
       ['claims', 'Claims', a.claims.length], ['mochi', 'Flashcards', a.mochiCandidates.length], ['repairs', 'Repairs', a.repairs.length]].forEach(function (c) {
        var b = el('button', { class: c[0] === tab ? 'on' : '' }, [c[1] + ' ' + c[2]]);
        b.onclick = function () { tab = c[0]; tabApi.refresh(); };
        chips.appendChild(b);
      });
      box.appendChild(chips);
      var list = el('div');
      box.appendChild(list);
      if (tab === 'highlights') a.highlights.forEach(function (h) {
        list.appendChild(item(h, [L.ui.label(h.label), el('span', { class: 'ai-meta' }, [h.why + ' · ' + stars(h.score)])]));
      });
      if (tab === 'quotes') a.pullQuotes.forEach(function (q) {
        var g = q.groupKind === 'chapter' ? (L.transcript.chapters[q.group] || {}).title || 'chapter ' + q.group : 'window ' + q.group;
        list.appendChild(item(q, [el('span', { class: 'ai-meta' }, [g])]));
      });
      if (tab === 'questions') a.questions.forEach(function (q) {
        list.appendChild(item(q.question, [el('span', { class: 'ai-meta' }, ['question'])],
          q.answer ? [el('span', { class: 'ai-a' }, ['↳ ' + fmt(q.answer.t0) + ' ' + quote(q.answer)])] : []));
      });
      if (tab === 'claims') a.claims.forEach(function (c) { list.appendChild(item(c, [el('span', { class: 'ai-meta' }, [c.type])])); });
      if (tab === 'mochi') a.mochiCandidates.forEach(function (m) { list.appendChild(item(m, [L.ui.label(m.label), el('span', { class: 'ai-meta' }, [m.type])])); });
      if (tab === 'repairs') {
        if (!a.repairs.length) list.appendChild(el('div', { class: 'empty' }, ['Nothing needed repair.']));
        a.repairs.forEach(function (x) { list.appendChild(el('div', { class: 'ai-repair' }, [x])); });
      }
    });
  }
  function signals(head, sig) {
    var line = el('div', { class: 'ai-sig' });
    if (sig && sig.heatmap && sig.heatmap.points) {
      var top = sig.heatmap.points.slice().sort(function (x, y) { return y.value - x.value; }).slice(0, 3).sort(function (x, y) { return x.start - y.start; });
      line.append('Most replayed: ');
      top.forEach(function (p) { var a = el('a', { title: 'replayed ' + Math.round(p.value * 100) + '%' }, [fmt(p.start)]); a.onclick = function () { L.video.seek(p.start); }; line.append(a); });
    } else line.append(sig ? 'No "most replayed" data. ' : 'Signals not fetched yet. ');
    if (sig && sig.sponsorblock) {
      line.append(' · SponsorBlock: ' + (sig.sponsorblock.segments.length ? '' : 'none'));
      sig.sponsorblock.segments.forEach(function (s) { var a = el('a', { title: s.category }, [s.category + ' ' + fmt(s.start) + '–' + fmt(s.end)]); a.onclick = function () { L.video.seek(s.start); }; line.append(a); });
    }
    head.appendChild(line);
  }

  var tabApi = L.transcript.addPanelTab('analysis-inspector', '🧪 Analysis', render);
  L.analysis.onChange(function () { tabApi.refresh(); });
})();
