// Labs experiment "mochi-candidates": a 🃏 Cards panel tab listing the analysis's `mochiCandidates` — spans worth a
// flashcard — each with its type, its AI label (LABS.ui.label, marked as AI), the exact words
// (LABS.transcript.text(span)), and the #mochi note the app WOULD write for it (CLAUDE.md rule 3, same bytes as
// core/notes.ts `block()` for a range note: start = first word's time, end = last word's time, quote line = the
// words, shortened to first 6 … last 6 above 15 words). Labs is read-only: nothing is written; "Copy note line" /
// "Copy all" put the lines on the clipboard (LABS.ui.copy). Candidates that overlap a note you already have are
// marked "you already noted this".
(function () {
  'use strict';

  // ---------- the note line (pure; unit-tested against core/notes.ts block()) ----------
  function clock(seconds) {
    var s = Math.max(0, Math.trunc(seconds)), h = Math.trunc(s / 3600), m = Math.trunc((s % 3600) / 60), x = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ':' + p2(m) + ':' + p2(x) : m + ':' + p2(x);
  }
  function shortQuote(text) {
    var w = String(text).split(/\s+/).filter(Boolean);
    return w.length <= 15 ? w.join(' ') : w.slice(0, 6).join(' ') + ' … ' + w.slice(-6).join(' ');
  }
  /** The lines of a #mochi range note: `> 💬 [m:ss–m:ss](url&t=Ns) #mochi label` + `> “quote”`. */
  function noteLines(videoId, start, end, label, quote) {
    var stamp = clock(start);
    if (end !== null && end !== undefined && clock(end) !== stamp) stamp += '–' + clock(end);
    var text = String(label || '').replace(/\s+/g, ' ').trim();
    var out = ['> 💬 [' + stamp + '](https://www.youtube.com/watch?v=' + videoId + '&t=' + Math.trunc(Math.max(0, start)) + 's) #mochi' + (text ? ' ' + text : '')];
    var q = shortQuote(quote);
    if (q !== '') out.push('> “' + q + '”');
    return out;
  }
  var core = { clock: clock, shortQuote: shortQuote, noteLines: noteLines };
  if (typeof window === 'undefined' || !window.LABS) { if (typeof globalThis !== 'undefined') globalThis.__mochiCandidates = core; return; }

  // ---------- the panel ----------
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, ID = 'mochi-candidates';
  L.ui.css(ID, [
    '.mc-head { position: sticky; top: -4px; z-index: 2; background: var(--panel); padding: 6px 6px 7px; border-bottom: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }',
    '.mc-head b { color: var(--ink); }',
    '.mc-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 5px; }',
    '.mc-row button, .mc-acts button { font: 12px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 1px 9px; cursor: pointer; }',
    '.mc-row button.on { background: var(--hl); border-color: var(--muted); font-weight: 600; }',
    '.mc-row button:hover, .mc-acts button:hover { border-color: var(--accent); }',
    '.mc-row .mc-all { margin-left: auto; border-color: var(--accent); color: var(--accent); }',
    '.mc-ro { margin-top: 5px; font-size: 11.5px; }',
    '.mc-item { padding: 7px 8px; border-bottom: 1px solid var(--line); border-radius: 6px; cursor: pointer; }',
    '.mc-item:hover { background: var(--hl); }',
    '.mc-top { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }',
    '.mc-t { font: 12px ui-monospace, monospace; color: var(--accent); }',
    '.mc-type { font: 600 10.5px/1.5 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }',
    '.mc-noted { font: 600 11px/1.5 system-ui, sans-serif; color: #15803d; border: 1px solid #86c79a; border-radius: 4px; padding: 0 5px; }',
    '@media (prefers-color-scheme: dark) { .mc-noted { color: #7ee2a0; border-color: #3f8a57; } }',
    '.mc-item.noted .mc-q { opacity: .65; }',
    '.mc-q { display: block; margin-top: 3px; color: var(--ink); line-height: 1.45; }',
    '.mc-q::before { content: "“"; } .mc-q::after { content: "”"; }',
    '.mc-acts { display: flex; gap: 5px; margin-top: 5px; }',
    '.mc-pre { margin: 6px 0 0; padding: 6px 8px; font: 11.5px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; background: var(--bg); border: 1px dashed var(--faint); border-radius: 6px; color: var(--ink); cursor: text; user-select: text; }',
    '.mc-where { font-size: 11.5px; color: var(--muted); margin-top: 3px; }',
    '.mc-empty { padding: 14px 10px; color: var(--muted); font-size: 13px; }',
    '.mc-empty button { margin-top: 8px; font: 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer; }',
  ].join('\n'));

  var TYPES = { vocab: 'term', concept: 'concept', quote: 'quote', person: 'person', book: 'book', stat: 'stat' };
  var typeFilter = 'all', hover = null, cards = [], open = {};
  var D = { t: function (p, w) { return L.transcript.paragraphs[p].times[w]; } };

  /** The note line for a candidate: start = its first word's time, end = its last word's time (like a highlight + N). */
  function linesOf(c) {
    return noteLines(L.transcript.id, D.t(c.startPara, c.startWord), D.t(c.endPara, c.endWord), c.label, L.transcript.text(c));
  }

  function stampOf(c) {
    var a = clock(D.t(c.startPara, c.startWord)), b = clock(D.t(c.endPara, c.endWord));
    return a === b ? a : a + '–' + b;
  }

  /** The user's notes that overlap the candidate (time ranges; a point note within 2 s; a note without time = its paragraph). */
  function notedBy(c, notes) {
    return notes.filter(function (n) {
      var a, b;
      if (n.time === null || n.time === undefined) {
        var P = L.transcript.paragraphs[n.para]; if (!P) return false;
        a = P.start; b = P.times[P.times.length - 1];
      } else if (n.end !== null && n.end !== undefined) { a = n.time; b = n.end; }
      else { a = n.time - 2; b = n.time + 2; }
      return a <= c.t1 && c.t0 <= b;
    });
  }

  function notesKey(notes) { return notes.map(function (n) { return n.para + ':' + n.time + ':' + n.end + ':' + n.category; }).join('|'); }
  var lastKey = '';

  function updateNoted() {
    var notes = L.notes(); lastKey = notesKey(notes);
    cards.forEach(function (k) {
      var by = notedBy(k.c, notes);
      k.noted = by.length > 0;
      k.el.classList.toggle('noted', k.noted);
      k.badge.style.display = k.noted ? '' : 'none';
      k.badge.textContent = '✓ you already noted this' + (by.some(function (n) { return n.category === 'mochi'; }) ? ' (🃏 mochi)' : '');
      k.badge.title = by.map(function (n) { return fmt(n.time === null ? L.transcript.paragraphs[n.para].start : n.time) + ' ' + n.text; }).join('\n');
    });
    var head = document.querySelector('.mc-count');
    if (head) head.textContent = countText();
  }
  function countText() {
    var shown = cards.filter(function (k) { return typeFilter === 'all' || k.c.type === typeFilter; });
    var noted = shown.filter(function (k) { return k.noted; }).length;
    return shown.length + ' flashcard candidate' + (shown.length === 1 ? '' : 's') + (noted ? ' · ' + noted + ' already noted' : '');
  }

  function copy(text, what) {
    try { L.ui.copy(text); L.ui.toast(what, 2200); } catch (e) { L.ui.toast('Could not copy: ' + e.message); }
  }

  function card(c) {
    var k = { c: c };
    var badge = el('span', { class: 'mc-noted', style: { display: 'none' } });
    var pre = el('pre', { class: 'mc-pre' }), where = el('div', { class: 'mc-where' });
    var previewBox = el('div', { style: { display: 'none' } }, [pre, where]);
    var prevBtn = el('button', { title: 'Show the exact note the app would write for this (nothing is written)' }, ['Preview as note']);
    var copyBtn = el('button', { title: 'Copy the note line(s) to the clipboard' }, ['Copy note line']);
    var it = el('div', { class: 'mc-item' }, [
      el('div', { class: 'mc-top' }, [el('span', { class: 'mc-t', title: 'First and last word, as the note would have them' }, [stampOf(c)]), el('span', { class: 'mc-type' }, [TYPES[c.type] || c.type]), L.ui.label(c.label), badge]),
      el('span', { class: 'mc-q' }, [L.transcript.text(c)]),
      el('div', { class: 'mc-acts' }, [prevBtn, copyBtn]),
      previewBox,
    ]);
    var keyOf = c.startPara + ':' + c.startWord;
    function setOpen(on) {
      open[keyOf] = on;
      if (on) {
        pre.textContent = linesOf(c).join('\n');
        where.textContent = 'Would go under the paragraph at ' + fmt(L.transcript.paragraphs[c.endPara].start) + ', after its notes. Labs is read-only — nothing is written.';
      }
      previewBox.style.display = on ? '' : 'none';
      prevBtn.textContent = on ? 'Hide preview' : 'Preview as note';
    }
    prevBtn.onclick = function (e) { e.stopPropagation(); setOpen(!open[keyOf]); };
    copyBtn.onclick = function (e) { e.stopPropagation(); copy(linesOf(c).join('\n'), '🃏 Note line copied — paste it under its paragraph in the .md'); };
    previewBox.onclick = function (e) { e.stopPropagation(); };
    it.onclick = function () { L.video.seek(c.t0); };
    it.onmouseenter = function () { if (hover) hover.remove(); hover = L.transcript.highlightRange(c); };
    it.onmouseleave = function () { if (hover) { hover.remove(); hover = null; } };
    if (open[keyOf]) setOpen(true);
    k.el = it; k.badge = badge;
    return k;
  }

  function render(box) {
    L.analysis.get().then(function (a) {
      box.textContent = ''; cards = [];
      if (!a) {
        box.appendChild(el('div', { class: 'mc-empty' }, ['Not analyzed yet. The flashcard candidates come from the 🧪 analysis of this video.', el('br'),
          el('button', { onclick: function () { L.analysis.run({}).then(function () { L.ui.toast('🧪 Analyzing… the candidates appear when it is done', 3000); }); } }, ['🧪 Analyze this video'])]));
        return;
      }
      var list = (a.mochiCandidates || []).slice().sort(function (x, y) { return x.t0 - y.t0; });
      if (!list.length) { box.appendChild(el('div', { class: 'mc-empty' }, ['The analysis found no flashcard candidates.'])); return; }
      var chips = el('div', { class: 'mc-row' });
      var types = ['all'].concat(Object.keys(TYPES).filter(function (t) { return list.some(function (c) { return c.type === t; }); }));
      var listEl = el('div');
      function apply() {
        cards.forEach(function (k) { k.el.style.display = typeFilter === 'all' || k.c.type === typeFilter ? '' : 'none'; });
        Array.prototype.forEach.call(chips.querySelectorAll('button[data-t]'), function (b) { b.classList.toggle('on', b.dataset.t === typeFilter); });
        countEl.textContent = countText();
      }
      types.forEach(function (t) {
        var n = t === 'all' ? list.length : list.filter(function (c) { return c.type === t; }).length;
        var b = el('button', { 'data-t': t }, [(t === 'all' ? 'All' : TYPES[t]) + ' ' + n]);
        b.onclick = function () { typeFilter = t; apply(); };
        chips.appendChild(b);
      });
      var all = el('button', { class: 'mc-all', title: 'Copy the note lines of every shown candidate you have not noted yet' }, ['Copy all']);
      all.onclick = function () {
        var pick = cards.filter(function (k) { return (typeFilter === 'all' || k.c.type === typeFilter) && !k.noted; });
        var skipped = cards.filter(function (k) { return (typeFilter === 'all' || k.c.type === typeFilter) && k.noted; }).length;
        if (!pick.length) { L.ui.toast('Nothing to copy — you already noted every shown candidate'); return; }
        copy(pick.map(function (k) { return linesOf(k.c).join('\n'); }).join('\n\n'),
          '🃏 Copied ' + pick.length + ' note line' + (pick.length === 1 ? '' : 's') + (skipped ? ' (' + skipped + ' already noted, skipped)' : ''));
      };
      chips.appendChild(all);
      var countEl = el('b', { class: 'mc-count' });
      box.append(el('div', { class: 'mc-head' }, [countEl, chips,
        el('div', { class: 'mc-ro' }, ['Labs is read-only: these are copied, never written. Labels are the AI’s; the quotes are the transcript’s words.'])]), listEl);
      list.forEach(function (c) { var k = card(c); cards.push(k); listEl.appendChild(k.el); });
      updateNoted();
      apply();
    });
  }

  var tabApi = L.transcript.addPanelTab(ID, '🃏 Cards', render);
  L.analysis.onChange(function () { tabApi.refresh(); });
  // notes load after the page and change while you watch: re-mark when they do (no re-render)
  setInterval(function () { if (cards.length && cards[0].el.isConnected && notesKey(L.notes()) !== lastKey) updateNoted(); }, 1500);
})();
