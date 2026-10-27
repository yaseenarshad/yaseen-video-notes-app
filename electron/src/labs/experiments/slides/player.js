// Labs experiment "slides": see a talk's slides without watching the speaker. Reads slides.json (extract.ts; plain
// code chose the slides, no AI) through /labs/x/slides/…:
//   1. 🖼 Slides tab — thumbnails with times; the slide on screen now is marked and kept in view; click = jump there;
//      hover = a big preview; a filter box over the slide text (OCR, macOS Vision).
//   2. Slides follow along (I) — the big current slide takes the video's place (the video keeps playing: its box is
//      only restyled into a small corner, never moved — moving the frame reloads it); ← / → step slide to slide.
//   3. Illustrated transcript — each slide's thumbnail inside the transcript where it appears (LABS.transcript.
//      addInlineCard: no paragraph elements, no text nodes); click = enlarge.
//   4. Deck reader (⇧I) — one slide at a time, large, with the EXACT transcript words spoken while it was up
//      (LABS.transcript.text over its t0–t1) and ▶ play from here; ← / → or J / K, Enter, Esc.
// Follow along and the deck are one LABS.mode ('slides'): the reel, the sampler or Read mode end it, and it ends them.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript;
  var ID = 'slides', BASE = '/labs/x/slides/', store = L.store(ID);

  L.ui.css(ID, [
    // the tab
    '.sl-head { padding: 6px 8px 8px; border-bottom: 1px solid var(--line); font: 13px/1.5 system-ui, sans-serif; color: var(--muted);',
    '  position: sticky; top: -4px; z-index: 1; background: var(--panel); }',
    '.sl-head b { color: var(--ink); }',
    '.sl-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.sl-row + .sl-row { margin-top: 6px; }',
    '.sl-btn { font: 600 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--ink);',
    '  border-radius: 999px; padding: 3px 10px; cursor: pointer; white-space: nowrap; }',
    '.sl-btn:hover { border-color: var(--muted); } .sl-btn.on { border-color: var(--accent); color: var(--accent); }',
    '.sl-q { flex: 1; min-width: 120px; font: 13px system-ui, sans-serif; padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px;',
    '  background: var(--bg); color: var(--ink); outline: none; } .sl-q:focus { border-color: var(--accent); }',
    '.sl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; padding: 8px 6px 12px; }',
    '.sl-th { position: relative; cursor: pointer; border-radius: 7px; padding: 3px; border: 2px solid transparent; }',
    '.sl-th img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px; background: #000;',
    '  box-shadow: 0 0 0 1px var(--line); }',
    '.sl-th:hover { background: var(--hl); } .sl-th.cur { border-color: var(--accent); background: var(--hl); }',
    '.sl-th .cap { display: flex; gap: 6px; align-items: baseline; font: 11.5px/1.6 ui-monospace, monospace; color: var(--muted); margin-top: 2px; }',
    '.sl-th.cur .cap { color: var(--accent); font-weight: 700; }',
    '.sl-th .cap .bd { font: 10.5px system-ui, sans-serif; border: 1px solid var(--line); border-radius: 999px; padding: 0 5px; }',
    '.sl-th .hit { font: 11.5px/1.35 system-ui, sans-serif; color: var(--ink); margin-top: 2px; display: -webkit-box; -webkit-box-orient: vertical;',
    '  -webkit-line-clamp: 2; overflow: hidden; } .sl-th .hit mark { background: var(--hl-word, #ffe58a); color: inherit; border-radius: 2px; }',
    '.sl-empty { padding: 14px 10px; font: 13.5px/1.5 system-ui, sans-serif; color: var(--muted); }',
    '.sl-empty b { color: var(--ink); }',
    '.sl-prog { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin: 8px 0 4px; }',
    '.sl-prog i { display: block; height: 100%; background: var(--accent); width: 0; transition: width .4s; }',
    // the hover preview
    '.sl-pop { position: fixed; z-index: 9; pointer-events: none; width: min(720px, 52vw); background: #000; border-radius: 10px; overflow: hidden;',
    '  box-shadow: 0 18px 60px rgba(0,0,0,.45); display: none; }',
    '.sl-pop img { display: block; width: 100%; } .sl-pop .pc { font: 12.5px system-ui, sans-serif; color: #ddd; padding: 5px 10px; background: #111; }',
    // follow along: the slide in the video's place, the video small in a corner (restyled, never moved)
    '.sl-stage { display: none; position: relative; flex: none; width: 100%; aspect-ratio: 16/9; max-height: 64vh; background: #000;',
    '  border-radius: 10px; overflow: hidden; }',
    'body.sl-follow .sl-stage { display: block; }',
    '.sl-stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }',
    '.sl-stage.out img { opacity: .45; }',
    '.sl-sbar { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 6px; opacity: 0; transition: opacity .2s; }',
    '.sl-stage:hover .sl-sbar, .sl-stage.out .sl-sbar { opacity: 1; }',
    '.sl-sbar button { font: 600 12.5px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.7); border: 1px solid rgba(255,255,255,.25);',
    '  border-radius: 999px; padding: 3px 10px; cursor: pointer; }',
    '.sl-sbar .lbl { font: 600 12.5px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.7); border-radius: 999px; padding: 3px 10px; }',
    '.sl-sbar .sp { flex: 1; }',
    'body.sl-follow .video { position: fixed !important; z-index: 6; right: 18px; bottom: 18px; width: 248px !important; max-width: none !important;',
    '  margin: 0 !important; border-radius: 8px; box-shadow: 0 10px 34px rgba(0,0,0,.45); transition: opacity .2s; }',
    'body.sl-follow.sl-camhide .video, body.sl-decking .video { opacity: 0; pointer-events: none; }',
    // the illustrated transcript
    '.sl-icard { margin: 8px 0 10px; width: min(300px, 70%); cursor: zoom-in; }',
    '.sl-icard img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 6px; box-shadow: 0 0 0 1px var(--line); background: #000; }',
    '.sl-icard::after { content: attr(data-label); display: block; font: 11.5px/1.7 ui-monospace, monospace; color: var(--muted); }',
    '.sl-icard.cur img { box-shadow: 0 0 0 2px var(--accent); } .sl-icard.cur::after { color: var(--accent); }',
    // lightbox
    '.sl-lb { position: fixed; inset: 0; z-index: 9; background: rgba(0,0,0,.82); display: flex; flex-direction: column; align-items: center;',
    '  justify-content: center; gap: 10px; padding: 24px; }',
    '.sl-lb img { max-width: min(1280px, 94vw); max-height: 80vh; border-radius: 8px; box-shadow: 0 20px 70px rgba(0,0,0,.6); }',
    '.sl-lb .lbar { display: flex; gap: 8px; align-items: center; font: 13px system-ui, sans-serif; color: #ddd; }',
    '.sl-lb button { font: 600 13px system-ui, sans-serif; color: #fff; background: #2a2a31; border: 1px solid #44444c; border-radius: 999px; padding: 5px 13px; cursor: pointer; }',
    // the deck reader
    'body.sl-decking { overflow: hidden; }',
    '.sl-deck { position: fixed; inset: 0; z-index: 7; background: var(--bg); color: var(--ink); display: flex; flex-direction: column; outline: none; }',
    '.sl-dtop { flex: none; display: flex; align-items: center; gap: 10px; padding: 9px 20px; border-bottom: 1px solid var(--line);',
    '  font: 13px system-ui, sans-serif; color: var(--muted); }',
    '.sl-dtop b { color: var(--ink); } .sl-dtop .sp { flex: 1; } .sl-dtop .ttl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
    '.sl-deck button { font: 600 13px system-ui, sans-serif; border: 1px solid var(--line); background: var(--panel); color: var(--ink);',
    '  border-radius: 999px; padding: 5px 13px; cursor: pointer; white-space: nowrap; } .sl-deck button:hover { border-color: var(--muted); }',
    '.sl-deck button.pri { background: var(--accent); border-color: var(--accent); color: #fff; }',
    '.sl-deck kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; background: var(--panel); }',
    '.sl-dmain { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr); gap: 22px; padding: 18px 22px 10px; }',
    '@media (max-width: 1000px) { .sl-dmain { grid-template-columns: 1fr; overflow-y: auto; } }',
    '.sl-dimg { min-height: 0; display: flex; flex-direction: column; gap: 8px; }',
    '.sl-dimg img { width: 100%; max-height: calc(100vh - 230px); object-fit: contain; object-position: top; border-radius: 8px; background: #000;',
    '  box-shadow: 0 0 0 1px var(--line); }',
    '.sl-dmeta { font: 13px system-ui, sans-serif; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }',
    '.sl-dmeta .n { font: 700 17px ui-monospace, monospace; color: var(--ink); }',
    '.sl-dtext { min-height: 0; overflow-y: auto; padding-right: 6px; scrollbar-width: thin; }',
    '.sl-dtext h3 { font: 600 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 2px 0 8px; }',
    '.sl-dtext .words { font: 19px/1.62 Georgia, "Iowan Old Style", serif; color: var(--ink); }',
    '.sl-dtext .none { font: italic 15px Georgia, serif; color: var(--muted); }',
    '.sl-dtext details { margin-top: 16px; font: 13px system-ui, sans-serif; color: var(--muted); }',
    '.sl-dtext details pre { white-space: pre-wrap; font: 13px/1.5 ui-monospace, monospace; color: var(--ink); background: var(--panel);',
    '  border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; margin: 6px 0 0; }',
    '.sl-strip { flex: none; display: flex; gap: 6px; overflow-x: auto; padding: 8px 20px 12px; border-top: 1px solid var(--line); scrollbar-width: thin; }',
    '.sl-strip img { height: 54px; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px; cursor: pointer; opacity: .62; border: 2px solid transparent; flex: none; }',
    '.sl-strip img:hover { opacity: 1; } .sl-strip img.on { opacity: 1; border-color: var(--accent); }',
  ].join('\n'));

  var S = null, slides = [], prefs = { inline: true, cam: 'small' };
  var job = null, poll = null;
  // ?v=: a new extraction replaces the files under the same names — the page must not show the old images it already loaded
  var imgURL = function (s) { return BASE + 'img/' + s.file.split('/').pop() + '?v=' + encodeURIComponent((S && S.createdAt) || ''); };
  function idxAt(t) { var c = -1; for (var i = 0; i < slides.length; i++) if (slides[i].t0 <= t + 0.25) c = i; else break; return c; }
  function label(s) { return 'Slide ' + s.n + ' · ' + fmt(s.t0) + (s.repeatOf ? ' (again, = slide ' + s.repeatOf + ')' : ''); }

  // ---------- the words spoken while a slide was up (verbatim, from the transcript) ----------
  function flatAt(t) { var a = T.at(t); return T.flat(a.para, a.word); }
  function timeOf(f) { var q = T.pos(f); return T.paragraphs[q[0]].times[q[1]]; }
  function spanOf(s) {
    var a = flatAt(s.t0), b = flatAt(Math.max(s.t0, s.t1 - 0.5));
    if (timeOf(a) < s.t0 - 0.5 && a < T.wordCount - 1) a++;   // a word that started on the slide before belongs to it
    if (b < a || timeOf(b) >= s.t1) return null;
    var p = T.pos(a), q = T.pos(b);
    return { startPara: p[0], startWord: p[1], endPara: q[0], endWord: q[1] };
  }

  // ---------- data + the extraction job ----------
  function load() {
    return fetch(BASE + 'slides.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (s) { S = s; slides = s && !s.noSlides ? s.slides : []; return s; });
  }
  var PHASE = { download: 'downloading', sample: 'looking', grab: 'saving', ocr: 'reading text', done: 'done', '': 'waiting' };
  var btn = L.ui.addButton({ id: 'slidesBtn', label: '🖼 Extract slides', title: 'Find the slides of this talk (Labs)', onClick: function (e) { onButton(e); } });
  function showButton() {
    if (job && job.state === 'running') { btn.textContent = '🖼 ' + (PHASE[job.phase] || 'working') + '… ' + (job.pct || 0) + '%'; btn.disabled = true; btn.title = job.line || ''; return; }
    btn.disabled = false;
    if (S && S.noSlides) { btn.textContent = '🖼 No slides'; btn.title = 'No slides found: ' + (S.reason || '') + ' — Shift-click to look again'; }
    else if (S) { btn.textContent = '🖼 Slides ' + slides.length; btn.title = slides.length + ' slides — click for the 🖼 Slides tab (I = follow along, ⇧I = deck). Shift-click to extract again.'; }
    else { btn.textContent = '🖼 Extract slides'; btn.title = job && job.state === 'failed' ? 'Last try failed: ' + job.error : 'Find the slides of this talk: downloads the video into Labs\' cache for a minute, keeps one image per slide, deletes the video'; }
  }
  function onButton(e) {
    if (job && job.state === 'running') return;
    if (S && !e.shiftKey) { if (S.noSlides) L.ui.toast('No slides found: ' + (S.reason || ''), 5000); else tab.show(); return; }
    extract(!!S);
  }
  function extract(force) {
    fetch(BASE + 'extract' + (force ? '?force=1' : ''), { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) {
      job = j; showButton(); refreshTab(); watch();
      L.log('slides: extract' + (force ? ' (force)' : ''));
    });
  }
  function watch() {
    clearInterval(poll);
    poll = setInterval(function () {
      fetch(BASE + 'status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        job = j; showButton(); updateProgress();
        if (j.state === 'running') return;
        clearInterval(poll); poll = null;
        if (j.state === 'failed') { L.ui.toast('Slides failed: ' + j.error, 7000); refreshTab(); return; }
        load().then(function () {
          showButton(); refreshTab(); drawInline();
          L.ui.toast(S && S.noSlides ? '🖼 No slides found in this video' : '🖼 ' + slides.length + ' slides · took ' + Math.round((j.ms || 0) / 1000) + ' s', 4000);
        });
      });
    }, 1000);
  }

  // ---------- 1. the 🖼 Slides tab ----------
  var grid = null, thumbs = [], qbox = null, progEl = null, query = '';
  function refreshTab() { tab.refresh(); }
  function updateProgress() {
    if (!progEl || !document.body.contains(progEl) || !job) return;
    progEl.firstChild.style.width = (job.pct || 0) + '%';
    progEl.nextSibling.textContent = (PHASE[job.phase] || '') + ' · ' + (job.line || '');
  }
  function render(box) {
    grid = null; thumbs = []; progEl = null;
    if (job && job.state === 'running') {
      progEl = el('div', { class: 'sl-prog' }, [el('i')]);
      box.append(el('div', { class: 'sl-empty' }, [el('b', {}, ['Finding the slides…']), progEl, el('div', {}, ['']),
        el('div', {}, ['The 720p video is downloaded into Labs\' cache, looked at second by second, and deleted afterwards.'])]));
      updateProgress();
      return;
    }
    if (!S) {
      box.append(el('div', { class: 'sl-empty' }, [el('b', {}, ['No slides yet.']), ' For a talk with a slide deck: ',
        el('button', { class: 'sl-btn', onclick: function () { extract(false); } }, ['🖼 Extract slides']),
        el('div', { style: { marginTop: '8px' } }, ['Plain code picks the slides (no AI): changes between frames, a picture must stay still for 2 s, camera shots are left out, builds are grouped. Then macOS Vision reads the slide text.']),
        job && job.state === 'failed' ? el('div', { style: { marginTop: '8px', color: 'var(--accent)' } }, ['Last try failed: ' + job.error]) : null]));
      return;
    }
    if (S.noSlides) {
      box.append(el('div', { class: 'sl-empty' }, [el('b', {}, ['No slides found.']), ' ' + (S.reason || ''),
        el('div', { style: { marginTop: '8px' } }, [el('button', { class: 'sl-btn', onclick: function () { extract(true); } }, ['Look again'])])]));
      return;
    }
    var ocrOK = S.ocr && S.ocr.state === 'ok';
    var followB = el('button', { class: 'sl-btn' + (following ? ' on' : ''), title: 'The big slide instead of the video (I)', onclick: function () { following ? closeFollow() : openFollow(); render2(); } }, ['▣ Follow along']);
    var deckB = el('button', { class: 'sl-btn', title: 'Read the talk slide by slide (⇧I)', onclick: function () { openDeck(); } }, ['📖 Deck']);
    var inlB = el('button', { class: 'sl-btn' + (prefs.inline ? ' on' : ''), title: 'Slide thumbnails inside the transcript', onclick: function () { prefs.inline = !prefs.inline; store.set('prefs', prefs); drawInline(); render2(); } }, [prefs.inline ? '☑ In transcript' : '☐ In transcript']);
    qbox = el('input', { class: 'sl-q', placeholder: ocrOK ? 'Filter by slide text (OCR)…' : 'No slide text (OCR ' + ((S.ocr && S.ocr.state) || 'off') + ')', spellcheck: 'false', value: query });
    if (!ocrOK) qbox.disabled = true;
    var count = el('span', {});
    qbox.addEventListener('input', function () { query = qbox.value; filter(count); });
    qbox.addEventListener('keydown', function (e) { if (e.key === 'Escape') { qbox.value = query = ''; filter(count); qbox.blur(); } e.stopPropagation(); });
    var builds = slides.filter(function (s) { return s.steps && s.steps.length > 1; }).length;
    box.append(el('div', { class: 'sl-head' }, [
      el('div', { class: 'sl-row' }, [el('span', {}, [el('b', {}, [slides.length + ' slides']), builds ? ' · ' + builds + ' with builds' : '', ' · text ' + (ocrOK ? '✓' : '✕')]), el('span', { style: { flex: 1 } }), followB, deckB, inlB]),
      el('div', { class: 'sl-row' }, [qbox, count]),
    ]));
    grid = el('div', { class: 'sl-grid' });
    slides.forEach(function (s, i) {
      var cap = el('div', { class: 'cap' }, [el('span', {}, [String(s.n)]), el('span', {}, [fmt(s.t0)]),
        s.steps && s.steps.length > 1 ? el('span', { class: 'bd', title: 'Built up in ' + s.steps.length + ' steps (this is the final state)' }, ['+' + (s.steps.length - 1)]) : null,
        s.repeatOf ? el('span', { class: 'bd', title: 'Shown again — first as slide ' + s.repeatOf }, ['↺ ' + s.repeatOf]) : null]);
      var th = el('div', { class: 'sl-th', title: 'Jump to ' + fmt(s.t0) }, [el('img', { src: imgURL(s), loading: 'lazy', alt: '' }), cap, el('div', { class: 'hit' })]);
      th.onclick = function () { L.video.seek(s.t0); };
      th.onmouseenter = function (e) { preview(s, th); };
      th.onmouseleave = function () { preview(null); };
      grid.appendChild(th); thumbs.push(th);
    });
    box.appendChild(grid);
    filter(count);
    lastCur = -2; mark(L.video.time(), true);
  }
  function render2() { if (grid && document.body.contains(grid)) tab.refresh(); }
  function filter(count) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean), n = 0;
    slides.forEach(function (s, i) {
      var th = thumbs[i], text = (s.text || ''), low = text.toLowerCase();
      var ok = terms.every(function (w) { return low.indexOf(w) >= 0; });
      th.style.display = ok ? '' : 'none';
      if (ok) n++;
      var hit = th.lastChild; hit.textContent = '';
      if (ok && terms.length) {
        var line = text.split('\n').filter(function (l) { return l.toLowerCase().indexOf(terms[0]) >= 0; })[0] || '';
        var at = line.toLowerCase().indexOf(terms[0]);
        hit.append(line.slice(0, at), el('mark', {}, [line.slice(at, at + terms[0].length)]), line.slice(at + terms[0].length));
        hit.title = 'slide text (OCR): ' + line;
      }
    });
    count.textContent = terms.length ? n + ' of ' + slides.length : '';
  }
  var pop = el('div', { class: 'sl-pop' }, [el('img', { alt: '' }), el('div', { class: 'pc' })]);
  document.body.appendChild(pop);
  function preview(s, anchor) {
    if (!s) { pop.style.display = 'none'; return; }
    pop.firstChild.src = imgURL(s);
    pop.lastChild.textContent = label(s) + ' – ' + fmt(s.t1);
    var r = anchor.getBoundingClientRect(), panel = anchor.closest('.panel') || anchor;
    var pr = panel.getBoundingClientRect(), w = Math.min(720, window.innerWidth * 0.52), h = w * 9 / 16 + 28;
    pop.style.left = Math.min(window.innerWidth - w - 10, pr.right + 14) + 'px';
    pop.style.top = Math.max(10, Math.min(window.innerHeight - h - 10, r.top + r.height / 2 - h / 2)) + 'px';
    pop.style.display = 'block';
  }
  var tab = T.addPanelTab(ID, '🖼 Slides', render);

  // the slide on screen now: the tab, the follow view, the cards in the transcript
  var lastCur = -2, viewIdx = -1;
  function mark(t, scroll) {
    var c = idxAt(t);
    if (c === lastCur && !scroll) return;
    lastCur = c;
    if (grid && document.body.contains(grid)) {
      thumbs.forEach(function (th, i) { th.classList.toggle('cur', i === c); });
      if (c >= 0 && thumbs[c].style.display !== 'none') thumbs[c].scrollIntoView({ block: 'nearest' });
    }
    cards.forEach(function (k) { k.el.classList.toggle('cur', k.i === c); });
    if (following && Date.now() > holdView) showStage(c);
  }
  L.video.onTick(function (s) { mark(s.t, false); }, 400);

  // ---------- 2. slides follow along ----------
  var following = false, holdView = 0, keysOff = null;
  var stageImg = el('img', { alt: '' }), stageLbl = el('span', { class: 'lbl' });
  var camB = el('button', { title: 'Show or hide the small video', onclick: function () { prefs.cam = prefs.cam === 'small' ? 'hidden' : 'small'; store.set('prefs', prefs); camState(); } });
  var stage = el('div', { class: 'sl-stage' }, [stageImg, el('div', { class: 'sl-sbar' }, [
    el('button', { title: 'Previous slide (←)', onclick: function () { step(-1); } }, ['◀']), stageLbl,
    el('button', { title: 'Next slide (→)', onclick: function () { step(1); } }, ['▶']), el('span', { class: 'sp' }), camB,
    el('button', { title: 'Back to the video (I or Esc)', onclick: function () { closeFollow(); } }, ['✕ Video']),
  ])]);
  stage.addEventListener('dblclick', function () { if (viewIdx >= 0) lightbox(viewIdx); });
  var vbox = L.video.box();
  if (vbox && vbox.parentNode) vbox.parentNode.insertBefore(stage, vbox);   // a sibling before the video: the frame is never moved
  function camState() {
    document.body.classList.toggle('sl-camhide', prefs.cam === 'hidden');
    camB.textContent = prefs.cam === 'hidden' ? '📹 Show video' : '📹 Hide video';
  }
  function showStage(i) {
    viewIdx = i;
    var s = slides[Math.max(0, i)];
    if (!s) return;
    if (stageImg.getAttribute('src') !== imgURL(s)) stageImg.src = imgURL(s);
    var out = i < 0 || L.video.time() >= s.t1;
    stage.classList.toggle('out', out);
    stageLbl.textContent = (i < 0 ? 'Before the first slide · ' : '') + s.n + ' / ' + slides.length + ' · ' + fmt(s.t0) + (out && i >= 0 ? ' · no slide on screen now' : '');
  }
  function step(d) {
    if (!slides.length) return;
    var base = viewIdx < 0 ? -1 : viewIdx, k = Math.max(0, Math.min(slides.length - 1, base + d));
    holdView = Date.now() + 1200;   // show the target at once; the tick catches up after the seek
    if (following) showStage(k);
    if (deckEl) deckShow(k);
    else L.video.seek(slides[k].t0, { play: !L.video.paused() });
  }
  function openFollow() {
    if (!slides.length) { L.ui.toast(S && S.noSlides ? 'No slides in this video.' : 'Extract the slides first (🖼 Extract slides under the video).', 3500); return; }
    if (following) return;
    enterMode();
    following = true;
    document.body.classList.add('sl-follow'); camState();
    showStage(idxAt(L.video.time()));
    L.log('slides: follow on');
  }
  function closeFollow(quiet) {
    if (!following) return;
    following = false;
    document.body.classList.remove('sl-follow', 'sl-camhide');
    if (!quiet) leaveMode();
    L.log('slides: follow off');
  }

  // the one mode ('slides') for follow along + deck; keys while it is on: ← → (J K, Enter, Esc in the deck)
  function enterMode() {
    if (L.mode.current() === ID) return;
    L.mode.enter(ID, function () { closeDeck(true); closeFollow(true); stopKeys(); });
    keysOff = L.ui.keyMode(function (k) {
      if (lbEl) {
        if (k === 'escape') { closeLightbox(); return true; }
        if (k === 'arrowleft' || k === 'arrowright') { lightbox(lbIdx + (k === 'arrowleft' ? -1 : 1)); return true; }
        return false;
      }
      if (deckEl) {
        if (k === 'arrowleft' || k === 'k') { deckShow(deckIdx - 1); return true; }
        if (k === 'arrowright' || k === 'j') { deckShow(deckIdx + 1); return true; }
        if (k === 'home') { deckShow(0); return true; }
        if (k === 'end') { deckShow(slides.length - 1); return true; }
        if (k === 'enter') { playFrom(deckIdx); return true; }
        if (k === 'escape' || k === 'shift+i') { closeDeck(); return true; }
        return k !== ' ' && k.length === 1;   // other letters stay in the deck; Space still plays / pauses
      }
      if (following) {
        if (k === 'arrowleft') { step(-1); return true; }
        if (k === 'arrowright') { step(1); return true; }
        if (k === 'escape') { closeFollow(); return true; }
      }
      return false;
    });
  }
  function stopKeys() { if (keysOff) { keysOff(); keysOff = null; } }
  function leaveMode() { if (following || deckEl) return; stopKeys(); L.mode.exit(ID); }

  // ---------- 3. the illustrated transcript ----------
  var cards = [];
  function drawInline() {
    cards.forEach(function (k) { k.remove(); });
    cards = [];
    if (!prefs.inline || !slides.length) return;
    slides.forEach(function (s, i) {
      var a = T.at(s.t0), f = T.flat(a.para, a.word);
      if (timeOf(f) < s.t0 - 0.5 && f < T.wordCount - 1) f++;
      var q = T.pos(f);
      var card = el('div', { class: 'sl-icard', 'data-label': '🖼 ' + label(s), title: 'Slide ' + s.n + ' — click to enlarge' }, [el('img', { src: imgURL(s), loading: 'lazy', alt: '' })]);
      card.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      card.addEventListener('click', function (e) { e.stopPropagation(); lightbox(i); });
      var c = T.addInlineCard(q[0], q[1], card);
      if (c) { c.i = i; cards.push(c); }
    });
    lastCur = -2; mark(L.video.time(), false);
  }

  // lightbox (click on a card / double-click the follow view)
  var lbEl = null, lbIdx = -1, lbKeys = null;
  function lightbox(i) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    var s = slides[i];
    if (lbEl) lbEl.remove();
    lbIdx = i;
    lbEl = el('div', { class: 'sl-lb' }, [el('img', { src: imgURL(s), alt: '' }), el('div', { class: 'lbar' }, [
      el('span', {}, [label(s) + ' – ' + fmt(s.t1)]),
      el('button', { onclick: function (e) { e.stopPropagation(); lightbox(i - 1); } }, ['◀']),
      el('button', { onclick: function (e) { e.stopPropagation(); lightbox(i + 1); } }, ['▶']),
      el('button', { onclick: function (e) { e.stopPropagation(); closeLightbox(); L.video.seek(s.t0, { play: true }); } }, ['▶ Play from here']),
      el('button', { onclick: function (e) { e.stopPropagation(); closeLightbox(); openDeck(i); } }, ['📖 In the deck']),
      el('button', { onclick: function (e) { e.stopPropagation(); closeLightbox(); } }, ['✕']),
    ])]);
    lbEl.addEventListener('click', function (e) { if (e.target === lbEl) closeLightbox(); });
    document.body.appendChild(lbEl);
    if (!keysOff && !lbKeys) lbKeys = L.ui.keyMode(function (k) {
      if (k === 'escape') { closeLightbox(); return true; }
      if (k === 'arrowleft' || k === 'arrowright') { lightbox(lbIdx + (k === 'arrowleft' ? -1 : 1)); return true; }
      return false;
    });
  }
  function closeLightbox() { if (lbEl) lbEl.remove(); lbEl = null; if (lbKeys) { lbKeys(); lbKeys = null; } }

  // ---------- 4. the deck reader ----------
  var deckEl = null, deckIdx = 0, dImg, dMeta, dText, dStrip;
  function openDeck(at) {
    if (!slides.length) { L.ui.toast(S && S.noSlides ? 'No slides in this video.' : 'Extract the slides first (🖼 Extract slides under the video).', 3500); return; }
    if (deckEl) return;
    enterMode();
    dImg = el('img', { alt: '' }); dMeta = el('div', { class: 'sl-dmeta' }); dText = el('div', { class: 'sl-dtext' }); dStrip = el('div', { class: 'sl-strip' });
    slides.forEach(function (s, i) { var im = el('img', { src: imgURL(s), loading: 'lazy', alt: '', title: label(s) }); im.onclick = function () { deckShow(i); }; dStrip.appendChild(im); });
    deckEl = el('div', { class: 'sl-deck', tabindex: '-1' }, [
      el('div', { class: 'sl-dtop' }, [el('b', {}, ['📖 Deck']), el('span', { class: 'ttl' }, [T.title || '']), el('span', { class: 'sp' }),
        el('span', {}, [el('kbd', {}, ['←']), ' ', el('kbd', {}, ['→']), ' or ', el('kbd', {}, ['J']), ' ', el('kbd', {}, ['K']), ' slides · ', el('kbd', {}, ['⏎']), ' play · ', el('kbd', {}, ['Esc']), ' close']),
        el('button', { onclick: function () { closeDeck(); } }, ['✕ Close'])]),
      el('div', { class: 'sl-dmain' }, [el('div', { class: 'sl-dimg' }, [dImg, dMeta]), dText]),
      dStrip,
    ]);
    document.body.appendChild(deckEl);
    document.body.classList.add('sl-decking');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    deckEl.focus();
    deckShow(at !== undefined ? at : Math.max(0, idxAt(L.video.time())));
    L.log('slides: deck open');
  }
  function deckShow(i) {
    if (!deckEl) return;
    deckIdx = Math.max(0, Math.min(slides.length - 1, i));
    var s = slides[deckIdx];
    dImg.src = imgURL(s);
    var span = spanOf(s), words = span ? T.flat(span.endPara, span.endWord) - T.flat(span.startPara, span.startWord) + 1 : 0;
    dMeta.textContent = '';
    [el('span', { class: 'n' }, [s.n + ' / ' + slides.length]), el('span', {}, [fmt(s.t0) + '–' + fmt(s.t1)]),
      s.steps && s.steps.length > 1 ? el('span', { title: s.steps.map(function (x) { return fmt(x.t0); }).join(' · ') }, ['built up in ' + s.steps.length + ' steps']) : null,
      s.repeatOf ? el('span', {}, ['shown again (first: slide ' + s.repeatOf + ')']) : null,
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'pri', onclick: function () { playFrom(deckIdx); } }, ['▶ Play from here'])]
      .forEach(function (x) { if (x) dMeta.appendChild(x); });
    dText.textContent = '';
    dText.append(el('h3', {}, ['Said while this slide was up · ' + words + ' words · ~' + Math.max(1, Math.round((s.t1 - s.t0) / 60)) + ' min']),
      span ? el('div', { class: 'words' }, [T.text(span)]) : el('div', { class: 'none' }, ['(nothing was said while this slide was up)']));
    if (s.text) dText.append(el('details', {}, [el('summary', {}, ['slide text (OCR)']), el('pre', {}, [s.text])]));
    dText.scrollTop = 0;
    Array.prototype.forEach.call(dStrip.children, function (im, k) { im.classList.toggle('on', k === deckIdx); });
    var on = dStrip.children[deckIdx]; if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function playFrom(i) { var s = slides[i]; closeDeck(); L.video.seek(s.t0, { play: true }); L.ui.toast('Playing from slide ' + s.n + ' (' + fmt(s.t0) + ')', 2000); }
  function closeDeck(quiet) {
    if (!deckEl) return;
    deckEl.remove(); deckEl = null;
    document.body.classList.remove('sl-decking');
    if (!quiet) leaveMode();
    L.log('slides: deck closed');
  }

  // ---------- keys, start ----------
  L.ui.addKey('i', function () { following ? closeFollow() : openFollow(); render2(); }, 'Slides follow along (Labs)');
  L.ui.addKey('shift+i', function () { deckEl ? closeDeck() : openDeck(); }, 'Slides: deck reader (Labs)');
  Promise.all([store.get('prefs'), load(), fetch(BASE + 'status', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return null; })]).then(function (r) {
    if (r[0] && typeof r[0] === 'object') { prefs.inline = r[0].inline !== false; prefs.cam = r[0].cam === 'hidden' ? 'hidden' : 'small'; }
    job = r[2]; showButton(); drawInline(); tab.refresh();
    if (job && job.state === 'running') watch();
  });
  window.LABS_slides = { openFollow: openFollow, closeFollow: closeFollow, openDeck: openDeck, closeDeck: closeDeck, lightbox: lightbox,
    closeLightbox: closeLightbox, show: function () { tab.show(); }, data: function () { return S; }, extract: extract, spanOf: spanOf };
})();
