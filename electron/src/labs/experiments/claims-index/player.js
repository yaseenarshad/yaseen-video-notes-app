// Labs experiment "claims-index": a 📌 Claims panel tab listing the analysis's `claims` — numbers / stats, people,
// companies, books and bold claims — grouped by type with counts. Every line is the transcript's own words
// (LABS.transcript.text(span)); click = play from there. People / companies / books are merged by their text
// (case, punctuation, a possessive 's and a leading "the" ignored): one row with "×3" and a time chip per mention.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, ID = 'claims-index';
  L.ui.css(ID, [
    '.ci-head { position: sticky; top: -4px; z-index: 2; background: var(--panel); padding: 6px 6px 7px; border-bottom: 1px solid var(--line); }',
    '.ci-head input { width: 100%; box-sizing: border-box; font: 13px system-ui, sans-serif; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }',
    '.ci-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }',
    '.ci-chips button { font: 12px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 1px 9px; cursor: pointer; }',
    '.ci-chips button:hover { border-color: var(--accent); }',
    '.ci-chips b { font-weight: 600; margin-left: 3px; }',
    '.ci-group { margin-top: 4px; }',
    '.ci-gh { display: flex; align-items: baseline; gap: 6px; padding: 8px 8px 4px; font: 600 12.5px system-ui, sans-serif; color: var(--ink); cursor: pointer; user-select: none; }',
    '.ci-gh .n { font-weight: 400; color: var(--muted); }',
    '.ci-gh::before { content: "▾"; color: var(--muted); width: 10px; }',
    '.ci-group.closed .ci-gh::before { content: "▸"; }',
    '.ci-group.closed .ci-rows { display: none; }',
    '.ci-row { padding: 5px 8px 6px 24px; border-radius: 6px; cursor: pointer; border-bottom: 1px solid var(--line); }',
    '.ci-row:hover { background: var(--hl); }',
    '.ci-t { font: 12px ui-monospace, monospace; color: var(--accent); margin-right: 6px; }',
    '.ci-q { color: var(--ink); line-height: 1.45; }',
    '.ci-q mark { background: var(--hl-word); color: var(--hl-ink); border-radius: 2px; }',
    '.ci-claim .ci-q::before { content: "“"; } .ci-claim .ci-q::after { content: "”"; }',
    '.ci-name { font-weight: 600; }',
    '.ci-x { font: 600 11.5px system-ui, sans-serif; color: var(--muted); margin-left: 6px; }',
    '.ci-times { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }',
    '.ci-times a { font: 11.5px ui-monospace, monospace; color: var(--accent); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; cursor: pointer; }',
    '.ci-times a:hover { border-color: var(--accent); }',
    '.ci-ctx { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }',
    '.ci-empty { padding: 14px 10px; color: var(--muted); font-size: 13px; }',
    '.ci-empty button { margin-top: 8px; font: 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer; }',
  ].join('\n'));

  var TYPES = [
    { type: 'stat', title: '🔢 Numbers & stats', merge: false },
    { type: 'person', title: '👤 People', merge: true },
    { type: 'company', title: '🏢 Companies & products', merge: true },
    { type: 'book', title: '📚 Books', merge: true },
    { type: 'claim', title: '💥 Bold claims', merge: false },
  ];
  var filter = '', closed = {}, hover = null;

  /** The merge key of a name: lowercase, no accents / punctuation, no possessive 's, no leading "the". */
  function key(text) {
    return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the /, '');
  }

  // a few words around a span (verbatim, for context under a short name)
  function around(span, before, after) {
    var T = L.transcript, a = T.flat(span.startPara, span.startWord), b = T.flat(span.endPara, span.endWord);
    var s = T.pos(Math.max(0, a - before)), e = T.pos(Math.min(T.wordCount - 1, b + after));
    return { startPara: s[0], startWord: s[1], endPara: e[0], endWord: e[1] };
  }

  // every place the transcript says these exact words (case, punctuation and a possessive 's ignored); names of ≤ 5 words
  var flatNorm = null;
  function mentionsOf(text) {
    var T = L.transcript, want = text.split(/\s+/).map(key).filter(Boolean);
    if (want[0] === 'the') want.shift();
    if (!want.length || want.length > 5) return [];
    if (!flatNorm) { flatNorm = []; T.paragraphs.forEach(function (p) { p.words.forEach(function (w) { flatNorm.push(key(w)); }); }); }
    var out = [];
    for (var f = 0; f + want.length <= flatNorm.length; f++) {
      var ok = true;
      for (var j = 0; j < want.length; j++) if (flatNorm[f + j] !== want[j]) { ok = false; break; }
      if (!ok) continue;
      var a = T.pos(f), b = T.pos(f + want.length - 1);
      out.push({ startPara: a[0], startWord: a[1], endPara: b[0], endWord: b[1], t0: T.paragraphs[a[0]].times[a[1]] });
      f += want.length - 1;
    }
    return out;
  }

  function groupsOf(a) {
    var claims = (a && a.claims ? a.claims : []).slice().sort(function (x, y) { return x.t0 - y.t0; });
    return TYPES.map(function (T) {
      var list = claims.filter(function (c) { return c.type === T.type; }).map(function (c) { return { span: c, text: L.transcript.text(c) }; });
      if (!T.merge) return { T: T, rows: list.map(function (x) { return { text: x.text, spans: [x.span] }; }), mentions: list.length };
      var by = {}, rows = [];
      list.forEach(function (x) {
        var k = key(x.text) || x.text;
        if (!by[k]) { by[k] = { text: x.text, spans: [], found: 0 }; rows.push(by[k]); }
        if (!by[k].spans.some(function (s) { return s.startPara === x.span.startPara && s.startWord === x.span.startWord; })) by[k].spans.push(x.span);
      });
      // the other times the same name is said (the exact words, found in the transcript)
      rows.forEach(function (r) {
        mentionsOf(r.text).forEach(function (s) {
          var f = L.transcript.flat(s.startPara, s.startWord);
          if (r.spans.some(function (x) { var a = L.transcript.flat(x.startPara, x.startWord), b = L.transcript.flat(x.endPara, x.endWord); return f >= a && f <= b; })) return;
          s.found = true; r.spans.push(s); r.found++;
        });
        r.spans.sort(function (x, y) { return x.t0 - y.t0; });
      });
      rows.sort(function (x, y) { return y.spans.length - x.spans.length || x.spans[0].t0 - y.spans[0].t0; });
      return { T: T, rows: rows, mentions: list.length };
    });
  }

  var terms = function () { return filter.toLowerCase().split(/\s+/).filter(Boolean); };
  // where a filter word starts a word of the text ("ai" finds "AI," and "AI-driven", not "said")
  function wordHits(text, w) {
    var out = [], low = text.toLowerCase();
    for (var i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(low[i - 1])) out.push([i, i + w.length]);
    return out;
  }
  function marked(text, cls) {
    var span = el('span', { class: cls }), t = terms(), low = text.toLowerCase(), at = 0, hits = [];
    t.forEach(function (w) { hits = hits.concat(wordHits(text, w)); });
    hits.sort(function (x, y) { return x[0] - y[0]; }).forEach(function (h) {
      if (h[0] < at) return;
      span.append(text.slice(at, h[0]), el('mark', {}, [text.slice(h[0], h[1])])); at = h[1];
    });
    span.append(text.slice(at));
    return span;
  }
  function hoverOn(it, span) {
    it.addEventListener('mouseenter', function () { if (hover) hover.remove(); hover = L.transcript.highlightRange(span); });
    it.addEventListener('mouseleave', function () { if (hover) { hover.remove(); hover = null; } });
  }

  function renderGroups(listEl, chipsEl, groups) {
    listEl.textContent = ''; chipsEl.textContent = '';
    var t = terms(), any = false;
    groups.forEach(function (g) {
      var rows = g.rows.filter(function (r) { return t.every(function (w) { return wordHits(r.text, w).length > 0; }); });
      var mentions = rows.reduce(function (n, r) { return n + r.spans.length; }, 0);
      var label = g.T.merge ? rows.length + (mentions !== rows.length ? ' · ' + mentions + ' mentions' : '') : String(rows.length);
      var box = el('div', { class: 'ci-group' + (closed[g.T.type] ? ' closed' : ''), 'data-type': g.T.type });
      var gh = el('div', { class: 'ci-gh', title: 'Click to fold / unfold' }, [g.T.title, el('span', { class: 'n' }, [label])]);
      gh.onclick = function () { closed[g.T.type] = !closed[g.T.type]; box.classList.toggle('closed', !!closed[g.T.type]); };
      var rowsEl = el('div', { class: 'ci-rows' });
      box.append(gh, rowsEl);
      var chip = el('button', { title: 'Jump to ' + g.T.title.slice(2).trim() }, [g.T.title, el('b', {}, [String(rows.length)])]);
      chip.onclick = function () { closed[g.T.type] = false; box.classList.remove('closed'); var pl = listEl.closest('.plist'), head = pl.querySelector('.ci-head'); pl.scrollTop = box.offsetTop - (head ? head.offsetHeight : 0) - 2; };
      if (rows.length) chipsEl.appendChild(chip);
      if (!rows.length) return;
      any = true;
      rows.forEach(function (r) {
        var first = r.spans[0], it;
        if (!g.T.merge) {
          it = el('div', { class: 'ci-row' + (g.T.type === 'claim' ? ' ci-claim' : '') }, [el('span', { class: 'ci-t' }, [fmt(first.t0)]), marked(r.text, 'ci-q')]);
        } else {
          var times = el('div', { class: 'ci-times' });
          r.spans.forEach(function (s, i) {
            var a = el('a', { title: (s.found ? 'said again (same words found in the transcript)' : 'marked by the analysis') + ':\n…' + L.transcript.text(around(s, 8, 8)) + '…' }, [fmt(s.t0)]);
            a.onclick = function (e) { e.stopPropagation(); L.video.seek(s.t0); };
            hoverOn(a, s);
            times.appendChild(a);
          });
          it = el('div', { class: 'ci-row' }, [el('span', { class: 'ci-t' }, [fmt(first.t0)]), marked(r.text, 'ci-q ci-name'),
            r.spans.length > 1 ? el('span', { class: 'ci-x', title: r.spans.length + ' mentions' + (r.found ? ' (' + r.found + ' found by searching the transcript for the same words)' : '') }, ['×' + r.spans.length]) : null,
            el('span', { class: 'ci-ctx', title: 'The words around the first mention (verbatim)' }, ['…' + L.transcript.text(around(first, 6, 6)) + '…']),
            r.spans.length > 1 ? times : null]);
        }
        it.onclick = function () { L.video.seek(first.t0); };
        hoverOn(it, first);
        rowsEl.appendChild(it);
      });
      listEl.appendChild(box);
    });
    if (!any) listEl.appendChild(el('div', { class: 'ci-empty' }, [filter ? 'Nothing matches the filter.' : 'The analysis found no claims.']));
  }

  function render(box) {
    L.analysis.get().then(function (a) {
      box.textContent = '';
      if (!a) {
        box.appendChild(el('div', { class: 'ci-empty' }, ['Not analyzed yet. The claims come from the 🧪 analysis of this video.', el('br'),
          el('button', { onclick: function () { L.analysis.run({}).then(function () { L.ui.toast('🧪 Analyzing… the claims appear when it is done', 3000); }); } }, ['🧪 Analyze this video'])]));
        return;
      }
      var groups = groupsOf(a);
      var input = el('input', { type: 'search', placeholder: 'Filter names, numbers, claims…', value: filter, spellcheck: 'false' });
      var chipsEl = el('div', { class: 'ci-chips' }), listEl = el('div');
      input.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { input.value = ''; filter = ''; renderGroups(listEl, chipsEl, groups); input.blur(); } });
      input.addEventListener('input', function () { filter = input.value; renderGroups(listEl, chipsEl, groups); });
      box.append(el('div', { class: 'ci-head' }, [input, chipsEl]), listEl);
      renderGroups(listEl, chipsEl, groups);
    });
  }

  var tabApi = L.transcript.addPanelTab(ID, '📌 Claims', render);
  L.analysis.onChange(function () { tabApi.refresh(); });
})();
