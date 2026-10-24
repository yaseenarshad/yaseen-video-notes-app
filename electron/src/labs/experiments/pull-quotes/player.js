// Labs experiment "pull-quotes": a "TL;DR without rewriting" — per chapter (or ~10-minute window) the 1–2 verbatim
// pull quotes from the analysis, with the chapter title and time. A ❝ Quotes panel tab, and a Read mode that shows only
// this list, large, as a scrollable page. Every quote's text is LABS.transcript.text(span); nothing is model-written.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript;
  var ID = 'pull-quotes', WPM = 250;

  L.ui.css(ID, [
    '.pq-head { padding: 6px 8px 8px; border-bottom: 1px solid var(--line); font: 13px/1.5 system-ui, sans-serif; color: var(--muted);',
    '  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; position: sticky; top: -4px; z-index: 1; background: var(--panel); }',
    '.pq-head b { color: var(--ink); }',
    '.pq-head button { margin-left: auto; font: 600 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--ink);',
    '  border-radius: 999px; padding: 3px 11px; cursor: pointer; }',
    '.pq-head button:hover { border-color: var(--muted); }',
    '.pq-g { padding: 8px 8px 4px; border-bottom: 1px solid var(--line); }',
    '.pq-g.cur { box-shadow: inset 3px 0 0 var(--accent); background: var(--hl); border-radius: 6px; }',
    '.pq-gt { font: 600 12.5px/1.4 system-ui, sans-serif; color: var(--ink); cursor: pointer; display: flex; gap: 8px; }',
    '.pq-gt .t { font: 12px/1.6 ui-monospace, monospace; color: var(--accent); flex: none; }',
    '.pq-gt:hover .t { text-decoration: underline; }',
    '.pq-q { display: block; margin: 4px 0 6px 0; padding: 2px 6px 2px 10px; border-left: 2px solid var(--line); font: italic 15px/1.5 Georgia, serif;',
    '  color: var(--ink); cursor: pointer; border-radius: 0 6px 6px 0; }',
    '.pq-q:hover { background: var(--hl); border-left-color: var(--accent); }',
    '.pq-q .qt { font: normal 11px ui-monospace, monospace; color: var(--muted); margin-left: 6px; white-space: nowrap; }',
    // Read mode
    'body.pq-reading { overflow: hidden; }',
    '.pq-read { position: fixed; inset: 0; z-index: 5; background: var(--bg); color: var(--ink); overflow-y: auto; outline: none;',
    '  scrollbar-width: thin; scrollbar-color: var(--faint) transparent; }',
    '.pq-read .bar2 { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 10px 22px;',
    '  background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);',
    '  font: 13px system-ui, sans-serif; color: var(--muted); }',
    '.pq-read .bar2 b { color: var(--ink); }',
    '.pq-read .bar2 .sp { flex: 1; }',
    '.pq-read button { font: 600 13px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--ink);',
    '  border-radius: 999px; padding: 5px 13px; cursor: pointer; }',
    '.pq-read button:hover { border-color: var(--muted); }',
    '.pq-page { max-width: 760px; margin: 0 auto; padding: 34px 28px 30vh; }',
    '.pq-page h1 { font: 700 30px/1.25 system-ui, sans-serif; margin: 0 0 6px; letter-spacing: -.01em; display: block; -webkit-line-clamp: unset; }',
    '.pq-page .sub { font: 14px system-ui, sans-serif; color: var(--muted); margin-bottom: 28px; }',
    '.pq-sec { margin: 34px 0 0; }',
    '.pq-sec h2 { font: 600 13px system-ui, sans-serif; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 10px;',
    '  display: flex; gap: 10px; align-items: baseline; cursor: pointer; }',
    '.pq-sec h2 .t { font: 13px ui-monospace, monospace; color: var(--accent); text-transform: none; letter-spacing: 0; }',
    '.pq-sec h2 .now { font: 700 10.5px system-ui, sans-serif; color: #fff; background: var(--accent); border-radius: 999px; padding: 1px 8px; letter-spacing: .04em; }',
    '.pq-big { position: relative; margin: 0 0 16px; padding: 4px 0 4px 22px; border-left: 3px solid var(--line); cursor: pointer;',
    '  font: clamp(20px, 2.1vw, 26px)/1.5 Georgia, "Iowan Old Style", serif; color: var(--ink); border-radius: 0 8px 8px 0; transition: background .15s; }',
    '.pq-big:hover, .pq-big.kb { border-left-color: var(--accent); background: var(--hl); }',
    '.pq-big .go { display: block; font: 12.5px ui-monospace, monospace; color: var(--muted); margin-top: 4px; }',
    '.pq-big:hover .go, .pq-big.kb .go { color: var(--accent); }',
    '.pq-read .keys { font: 12px system-ui, sans-serif; color: var(--muted); }',
    '.pq-read kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; background: var(--panel); }',
  ].join('\n'));

  var hover = null, reading = null;

  // groups: [{ title, start, kind, quotes: [span…] }] in time order
  function groups(a) {
    var by = {};
    a.pullQuotes.forEach(function (q) {
      var k = q.groupKind + ':' + q.group;
      if (!by[k]) {
        var ch = q.groupKind === 'chapter' ? T.chapters[q.group] : null;
        var start = ch ? ch.start : q.groupKind === 'window' ? q.group * 600 : q.t0;
        var title = ch ? ch.title : q.groupKind === 'window' ? fmt(q.group * 600) + '–' + fmt((q.group + 1) * 600) : 'Part ' + (q.group + 1);
        by[k] = { key: k, title: title, start: start, kind: q.groupKind, quotes: [] };
      }
      by[k].quotes.push(q);
    });
    var list = Object.keys(by).map(function (k) { return by[k]; });
    list.forEach(function (g) { g.quotes.sort(function (x, y) { return x.t0 - y.t0; }); g.start = Math.min(g.start, g.quotes[0].t0); });
    list.sort(function (x, y) { return x.start - y.start; });
    return list;
  }
  function wordsIn(a) { var n = 0; a.pullQuotes.forEach(function (q) { n += T.flat(q.endPara, q.endWord) - T.flat(q.startPara, q.startWord) + 1; }); return n; }
  function readMin(a) { return Math.max(1, Math.round(wordsIn(a) / WPM)); }
  function human(s) { var m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60); }
  function curGroup(gs, t) { var c = -1; gs.forEach(function (g, i) { if (g.start <= t + 0.5) c = i; }); return c; }

  // ---------- the panel tab ----------
  var gEls = [], gList = [];
  function render(box) {
    box.textContent = 'Loading…';
    L.analysis.get().then(function (a) {
      box.textContent = '';
      gEls = []; gList = [];
      if (!a || !a.pullQuotes || !a.pullQuotes.length) {
        box.appendChild(el('div', { class: 'empty' }, [a ? 'This analysis has no pull quotes.' : 'Not analyzed yet — press 🧪 Analyze under the video.']));
        return;
      }
      gList = groups(a);
      box.appendChild(el('div', { class: 'pq-head' }, [
        el('span', {}, [el('b', {}, [a.pullQuotes.length + ' quotes']), ' · ' + gList.length + (gList[0].kind === 'window' ? ' parts' : ' chapters') + ' · ~' + readMin(a) + ' min read']),
        el('button', { title: 'Only the quotes, large, as a page (⇧Q)', onclick: openRead }, ['📖 Read mode']),
      ]));
      gList.forEach(function (g) {
        var ge = el('div', { class: 'pq-g' });
        var gt = el('div', { class: 'pq-gt', title: 'Jump to the start of this part' }, [el('span', { class: 't' }, [fmt(g.start)]), el('span', {}, [g.title])]);
        gt.onclick = function () { L.video.seek(g.start + 0.3); };
        ge.appendChild(gt);
        g.quotes.forEach(function (q) {
          var qe = el('span', { class: 'pq-q', title: 'Jump here' }, ['“' + T.text(q) + '”', el('span', { class: 'qt' }, [fmt(q.t0)])]);
          qe.onclick = function () { L.video.seek(q.t0); };
          qe.onmouseenter = function () { if (hover) hover.remove(); hover = T.highlightRange(q); };
          qe.onmouseleave = function () { if (hover) { hover.remove(); hover = null; } };
          ge.appendChild(qe);
        });
        box.appendChild(ge); gEls.push(ge);
      });
      mark(L.video.time(), true);
    });
  }
  var lastCur = -2;
  function mark(t, scroll) {
    if (!gEls.length || !document.body.contains(gEls[0])) return;
    var c = curGroup(gList, t);
    if (c === lastCur && !scroll) return;
    lastCur = c;
    gEls.forEach(function (g, i) { g.classList.toggle('cur', i === c); });
    if (c >= 0 && scroll) gEls[c].scrollIntoView({ block: 'nearest' });
  }
  L.video.onTick(function (s) { mark(s.t, false); }, 500);

  var tab = T.addPanelTab(ID, '❝ Quotes', render);
  L.analysis.onChange(function () { tab.refresh(); if (reading) openRead(); });

  // ---------- Read mode ----------
  var kb = -1, bigs = [];
  function openRead() {
    L.analysis.get().then(function (a) {
      if (!a || !a.pullQuotes || !a.pullQuotes.length) { L.ui.toast('No pull quotes yet — analyze this video first (🧪 Analyze).', 3500); return; }
      if (reading) reading.remove();
      var gs = groups(a), cur = curGroup(gs, L.video.time());
      bigs = []; kb = -1;
      var page = el('div', { class: 'pq-page' }, [
        el('h1', {}, [T.title || '']),
        el('div', { class: 'sub' }, [(T.channel ? T.channel + ' · ' : '') + a.pullQuotes.length + ' quotes from ' + human(L.video.duration() || T.duration || 0) +
          ' · about ' + readMin(a) + ' min to read · the speakers’ exact words, picked by the AI']),
      ]);
      gs.forEach(function (g, i) {
        var h2 = el('h2', { title: 'Play from the start of this part' }, [el('span', { class: 't' }, [fmt(g.start)]), el('span', {}, [g.title]),
          i === cur ? el('span', { class: 'now', title: 'The video is in this part now' }, ['YOU ARE HERE']) : null]);
        h2.onclick = function () { closeRead(); L.video.seek(g.start + 0.3, { play: true }); };
        var sec = el('div', { class: 'pq-sec' }, [h2]);
        g.quotes.forEach(function (q) {
          var b = el('div', { class: 'pq-big', title: 'Play from here' }, ['“' + T.text(q) + '”', el('span', { class: 'go' }, ['▶ ' + fmt(q.t0)])]);
          b.onclick = function () { play(q); };
          b._q = q;
          sec.appendChild(b); bigs.push(b);
        });
        page.appendChild(sec);
      });
      reading = el('div', { class: 'pq-read', tabindex: '-1' }, [
        el('div', { class: 'bar2' }, [el('b', {}, ['❝ Pull quotes']), el('span', { class: 'sp' }),
          el('span', { class: 'keys' }, [el('kbd', {}, ['J']), ' ', el('kbd', {}, ['K']), ' next / previous · ', el('kbd', {}, ['⏎']), ' play · ', el('kbd', {}, ['Esc']), ' close']),
          el('button', { onclick: closeRead, title: 'Esc' }, ['✕ Close'])]),
        page,
      ]);
      document.body.appendChild(reading);
      document.body.classList.add('pq-reading');
      reading.focus();
      L.log('pull-quotes: read mode ' + a.pullQuotes.length + ' quotes');
    });
  }
  function play(q) { closeRead(); L.video.seek(q.t0, { play: true }); L.ui.toast('Playing from ' + fmt(q.t0), 1800); }
  function closeRead() { if (!reading) return; reading.remove(); reading = null; document.body.classList.remove('pq-reading'); }
  function setKb(i) {
    if (!bigs.length) return;
    kb = Math.max(0, Math.min(bigs.length - 1, i));
    bigs.forEach(function (b, j) { b.classList.toggle('kb', j === kb); });
    bigs[kb].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // while Read mode is open, keys belong to it (scrolling keys keep their normal effect)
  window.addEventListener('keydown', function (e) {
    if (!reading || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' || (k === 'q' && e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); closeRead(); return; }
    if (k === 'j') { e.preventDefault(); setKb(kb + 1); }
    else if (k === 'k') { e.preventDefault(); setKb(kb - 1); }
    else if (k === 'Enter') { e.preventDefault(); if (kb >= 0) play(bigs[kb]._q); }
    // ↑ ↓ Space PageUp PageDown Home End scroll the page (their default); every other key is kept from the player
    e.stopImmediatePropagation();
  }, true);
  L.ui.addKey('shift+q', function () { if (reading) closeRead(); else openRead(); }, 'Pull quotes: Read mode (Labs)');
  window.LABS_pullQuotes = { openRead: openRead, closeRead: closeRead, show: function () { tab.show(); } };
})();
