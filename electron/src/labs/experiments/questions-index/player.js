// Labs experiment "questions-index": a ❓ Questions panel tab listing every question the host asked (the analysis's
// `questions`), verbatim — the words come only from LABS.transcript.text(span). Click = play from the question,
// "▶ answer" = play from where the answer starts. A filter box narrows the list (all typed words must appear).
// "Interview map" mode: a numbered list with the current question marked; Q / Shift+Q jump to the next / previous
// question (of the filtered list, when a filter is typed) and play from there.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, ID = 'questions-index';
  var state = L.store(ID);
  L.ui.css(ID, [
    '.qi-head { position: sticky; top: -4px; z-index: 2; background: var(--panel); padding: 6px 6px 8px; border-bottom: 1px solid var(--line); }',
    '.qi-row { display: flex; gap: 6px; align-items: center; }',
    '.qi-head input { flex: 1; min-width: 0; font: 13px system-ui, sans-serif; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }',
    '.qi-modes { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; flex: none; }',
    '.qi-modes button { font: 12px system-ui, sans-serif; border: 0; background: transparent; color: var(--muted); padding: 3px 9px; cursor: pointer; }',
    '.qi-modes button.on { background: var(--hl); color: var(--ink); font-weight: 600; }',
    '.qi-count { font-size: 12px; color: var(--muted); margin-top: 5px; }',
    '.qi-item { padding: 7px 8px; border-bottom: 1px solid var(--line); border-radius: 6px; cursor: pointer; }',
    '.qi-item:hover { background: var(--hl); }',
    '.qi-item.cur { background: var(--hl); box-shadow: inset 3px 0 0 var(--accent); }',
    '.qi-top { display: flex; align-items: baseline; gap: 6px; }',
    '.qi-n { font: 600 11.5px ui-monospace, monospace; color: var(--muted); min-width: 22px; text-align: right; flex: none; }',
    '.qi-t { font: 12px ui-monospace, monospace; color: var(--accent); flex: none; }',
    '.qi-q { color: var(--ink); line-height: 1.45; }',
    '.qi-q::before { content: "“"; } .qi-q::after { content: "”"; }',
    '.qi-q mark, .qi-a mark { background: var(--hl-word); color: var(--hl-ink); border-radius: 2px; }',
    '.qi-a { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin: 3px 0 0 28px; font-size: 12.5px; color: var(--muted); }',
    '.qi-ans { margin: 4px 0 0 28px; font: 12px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 999px; padding: 1px 9px; cursor: pointer; }',
    '.qi-ans:hover { border-color: var(--accent); color: var(--accent); }',
    '.qi-noans { margin: 4px 0 0 28px; font-size: 11.5px; color: var(--muted); }',
    '.qi-map .qi-item { padding: 4px 8px; border-bottom: 0; }',
    '.qi-map .qi-q { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }',
    '.qi-map .qi-ans { margin: 0; padding: 0 7px; font-size: 11px; flex: none; }',
    '.qi-keys { font-size: 11.5px; color: var(--muted); margin-top: 4px; }',
    '.qi-keys kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }',
    '.qi-empty { padding: 14px 10px; color: var(--muted); font-size: 13px; }',
    '.qi-empty button { margin-top: 8px; font: 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer; }',
  ].join('\n'));

  var qs = [];               // [{ n, q: span, a: span | null, text, answerText }] in time order
  var mode = 'list', filter = '', loaded = false;
  var listEl = null, countEl = null, hover = null, items = [];
  var gutter = L.transcript.addGutterLayer(ID);

  function load(a) {
    loaded = true;
    qs = (a && a.questions ? a.questions : []).slice().sort(function (x, y) { return x.question.t0 - y.question.t0; }).map(function (q, i) {
      return { n: i + 1, q: q.question, a: q.answer || null, text: L.transcript.text(q.question), answerText: q.answer ? L.transcript.text(q.answer) : '' };
    });
    gutter.clear();
    var marked = {};
    qs.forEach(function (q) {
      if (marked[q.q.startPara]) return;
      marked[q.q.startPara] = true;
      gutter.set(q.q.startPara, '❓', { title: 'Question ' + q.n + ' (questions index) — click to play from it', onClick: function () { L.video.seek(q.q.t0); } });
    });
  }

  var terms = function () { return filter.toLowerCase().split(/\s+/).filter(Boolean); };
  // where a filter word starts a word of the text ("ai" finds "AI," and "AI-driven", not "said")
  function wordHits(text, w) {
    var out = [], low = text.toLowerCase();
    for (var i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(low[i - 1])) out.push([i, i + w.length]);
    return out;
  }
  function matches(q) {
    var t = terms(); if (!t.length) return true;
    var hay = (q.text + ' ' + q.answerText).toLowerCase();
    return t.every(function (w) { return wordHits(hay, w).length > 0; });
  }
  function shown() { return qs.filter(matches); }

  // the verbatim text with the filter's words marked (the text itself is unchanged)
  function marked(text, cls) {
    var span = el('span', { class: cls }), t = terms();
    if (!t.length) { span.textContent = text; return span; }
    var low = text.toLowerCase(), hits = [];
    t.forEach(function (w) { hits = hits.concat(wordHits(text, w)); });
    hits.sort(function (x, y) { return x[0] - y[0]; });
    var at = 0;
    hits.forEach(function (h) {
      if (h[0] < at) { if (h[1] > at) { span.lastChild.textContent += text.slice(at, h[1]); at = h[1]; } return; }
      span.append(text.slice(at, h[0]), el('mark', {}, [text.slice(h[0], h[1])]));
      at = h[1];
    });
    span.append(text.slice(at));
    return span;
  }

  // the question being discussed now: the last one that started at or before the playhead
  function currentIn(list, t) { var c = -1; list.forEach(function (q, i) { if (q.q.t0 <= t + 0.5) c = i; }); return c; }

  function answerButton(q) {
    var b = el('button', { class: 'qi-ans', title: 'Play from where the answer starts' }, ['▶ answer ' + fmt(q.a.t0)]);
    b.onclick = function (e) { e.stopPropagation(); L.video.seek(q.a.t0); };
    return b;
  }

  function renderList() {
    if (!listEl) return;
    listEl.textContent = '';
    listEl.className = mode === 'map' ? 'qi-map' : '';
    items = [];
    var list = shown();
    countEl.textContent = (filter ? list.length + ' of ' + qs.length : qs.length) + ' question' + (qs.length === 1 ? '' : 's') +
      ' asked' + (filter ? ' match “' + filter.trim() + '”' : '') + ' · verbatim from the transcript';
    if (!list.length) { listEl.appendChild(el('div', { class: 'qi-empty' }, [qs.length ? 'No question matches the filter.' : 'The analysis found no questions.'])); return; }
    list.forEach(function (q) {
      var it = el('div', { class: 'qi-item', 'data-n': q.n });
      if (mode === 'map') {
        it.append(el('div', { class: 'qi-top' }, [el('span', { class: 'qi-n' }, [q.n + '.']), el('span', { class: 'qi-t' }, [fmt(q.q.t0)]), marked(q.text, 'qi-q')].concat(q.a ? [answerButton(q)] : [])));
      } else {
        it.append(el('div', { class: 'qi-top' }, [el('span', { class: 'qi-n' }, [q.n + '.']), el('span', { class: 'qi-t' }, [fmt(q.q.t0)]), marked(q.text, 'qi-q')]));
        if (q.a) {
          it.append(answerButton(q));
          var a = marked(q.answerText, 'qi-a'); a.title = 'How the answer starts (verbatim)'; it.append(a);
        } else it.append(el('div', { class: 'qi-noans' }, ['no answer marked']));
      }
      it.onclick = function () { L.video.seek(q.q.t0); };
      it.onmouseenter = function () { if (hover) hover.remove(); hover = L.transcript.highlightRange(q.q); };
      it.onmouseleave = function () { if (hover) { hover.remove(); hover = null; } };
      listEl.appendChild(it);
      items.push({ q: q, el: it });
    });
    markCurrent(true);
  }

  var lastCur = null;
  function markCurrent(scroll) {
    if (!items.length) return;
    var c = currentIn(items.map(function (x) { return x.q; }), L.video.time());
    var cur = c >= 0 ? items[c] : null;
    if (cur === lastCur && !scroll) return;
    items.forEach(function (x) { x.el.classList.toggle('cur', x === cur); });
    lastCur = cur;
    if (cur && mode === 'map' && cur.el.isConnected) {
      var box = cur.el.closest('.plist'), r = cur.el.getBoundingClientRect(), b = box && box.getBoundingClientRect();
      if (b && (r.top < b.top + 60 || r.bottom > b.bottom)) cur.el.scrollIntoView({ block: 'center' });
    }
  }

  function render(box) {
    listEl = null; lastCur = null;
    L.analysis.get().then(function (a) {
      if (!loaded || a === null) load(a);
      box.textContent = '';
      if (!a) {
        box.appendChild(el('div', { class: 'qi-empty' }, ['Not analyzed yet. The questions come from the 🧪 analysis of this video.', el('br'),
          el('button', { onclick: function () { L.analysis.run({}).then(function () { L.ui.toast('🧪 Analyzing… the questions appear when it is done', 3000); }); } }, ['🧪 Analyze this video'])]));
        return;
      }
      var input = el('input', { type: 'search', placeholder: 'Filter questions…', value: filter, spellcheck: 'false' });
      input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { input.value = ''; filter = ''; renderList(); input.blur(); } });
      input.addEventListener('input', function () { filter = input.value; renderList(); });
      var modes = el('span', { class: 'qi-modes' });
      [['list', 'List'], ['map', 'Interview map']].forEach(function (m) {
        var b = el('button', { class: m[0] === mode ? 'on' : '', title: m[0] === 'map' ? 'A numbered map of the interview; Q / Shift+Q step through it' : 'Every question with the start of its answer' }, [m[1]]);
        b.onclick = function () { mode = m[0]; state.set('mode', mode); Array.prototype.forEach.call(modes.children, function (x) { x.classList.toggle('on', x === b); }); renderList(); };
        modes.appendChild(b);
      });
      countEl = el('div', { class: 'qi-count' });
      var head = el('div', { class: 'qi-head' }, [el('div', { class: 'qi-row' }, [input, modes]), countEl,
        el('div', { class: 'qi-keys' }, [el('kbd', {}, ['Q']), ' next question · ', el('kbd', {}, ['⇧Q']), ' previous (plays from it)'])]);
      listEl = el('div');
      box.append(head, listEl);
      renderList();
    });
  }

  // Q / Shift+Q: next / previous question of the (filtered) list, playing from it
  function step(dir) {
    var list = shown();
    if (!list.length) { L.ui.toast(qs.length ? 'No question matches the filter' : 'No questions (analyze the video first)'); return; }
    var t = L.video.time(), c = currentIn(list, t), target;
    if (dir > 0) target = c + 1;
    else target = c >= 0 && t - list[c].q.t0 > 4 ? c : c - 1;   // like a "previous track" button: restart, then go back
    if (target >= list.length) { L.ui.toast('That was the last question'); return; }
    if (target < 0) { L.ui.toast('That was the first question'); return; }
    var q = list[target];
    L.video.seek(q.q.t0);
    L.ui.toast('❓ ' + q.n + ' / ' + qs.length + (filter ? ' (filtered)' : '') + ' · ' + fmt(q.q.t0), 1500);
    setTimeout(function () { markCurrent(true); }, 400);
  }
  L.ui.addKey('q', function () { step(1); }, 'Next question (questions index)');
  L.ui.addKey('shift+q', function () { step(-1); }, 'Previous question (questions index)');

  state.get('mode').then(function (m) { if (m === 'map' || m === 'list') mode = m; }).catch(function () {});
  L.analysis.get().then(load);
  var tabApi = L.transcript.addPanelTab(ID, '❓ Questions', render);
  L.analysis.onChange(function (a) { load(a); tabApi.refresh(); });
  L.video.onTick(function () { if (listEl && listEl.isConnected) markCurrent(false); }, 500);
})();
