// Labs experiment "highlight-reel": a TikTok-style Reel mode over the AI highlights.
// The video stays on top (its box is restyled, never moved — moving the frame reloads it); below it a big card shows
// the highlight's exact transcript words (LABS.transcript.text of single-word spans, so the current word can be
// marked as it is said), the AI label (LABS.ui.label), the "why" tag, "7 / 18" and the time. Highlights play back to
// back at the user's speed. Saved ("liked") moments live in LABS.store('highlight-reel') per video.
(function () {
  'use strict';
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, T = L.transcript;
  var ID = 'highlight-reel', store = L.store(ID), VKEY = 'video:' + T.id;

  L.ui.css(ID, [
    'body.hr-on { --hr-top: 58px; --hr-vh: min(46vh, calc((100vw - 200px) * 9 / 16)); --hr-vw: calc(var(--hr-vh) * 16 / 9); }',
    'body.hr-on .video { position: fixed !important; z-index: 6; top: var(--hr-top); left: 50%; transform: translateX(-50%);',
    '  width: var(--hr-vw) !important; height: var(--hr-vh); max-width: none !important; margin: 0 !important; border-radius: 14px;',
    '  box-shadow: 0 24px 70px rgba(0,0,0,.65); transition: opacity .2s; }',
    'body.hr-sum .video { opacity: 0; pointer-events: none; }',
    '.hr-shield { display: none; }',
    'body.hr-on .hr-shield { display: flex; position: absolute; inset: 0; z-index: 3; align-items: center; justify-content: center; cursor: pointer; }',
    '.hr-shield b { display: none; width: 76px; height: 76px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff;',
    '  font: 34px/76px system-ui, sans-serif; text-align: center; padding-left: 6px; box-sizing: border-box; }',
    'body.hr-paused .hr-shield b { display: block; }',
    '.hr { position: fixed; inset: 0; z-index: 5; background: radial-gradient(ellipse at 50% 20%, #1a1a20 0%, #0b0b0d 70%); color: #f2f0ea;',
    '  font: 15px/1.5 system-ui, -apple-system, sans-serif; user-select: none; -webkit-user-select: none; outline: none; }',
    '.hr .labs-label { color: #c9b8ff; border-color: #8c6cf0; font-size: 12px; }',
    '.hr button { font: 600 13px system-ui, sans-serif; color: #f2f0ea; background: #222228; border: 1px solid #34343c; border-radius: 999px;',
    '  padding: 5px 13px; cursor: pointer; white-space: nowrap; }',
    '.hr button:hover { border-color: #6a6a74; background: #2a2a31; }',
    '.hr button.on { background: #f2f0ea; color: #111; border-color: #f2f0ea; }',
    '.hr kbd { font: 11px ui-monospace, monospace; border: 1px solid #3a3a42; border-bottom-width: 2px; border-radius: 5px; padding: 0 5px;',
    '  color: #d6d3cc; background: #1b1b20; }',
    '.hr-top { position: absolute; top: 0; left: 0; right: 0; height: 50px; display: flex; align-items: center; gap: 10px; padding: 0 18px; }',
    '.hr-brand { font-weight: 700; letter-spacing: .01em; white-space: nowrap; }',
    '.hr-title { color: #8f8b84; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }',
    '.hr-seg { display: flex; gap: 0; } .hr-seg button { border-radius: 0; } .hr-seg button:first-child { border-radius: 999px 0 0 999px; }',
    '.hr-seg button:last-child { border-radius: 0 999px 999px 0; border-left: 0; }',
    '.hr-x { width: 32px; padding: 5px 0 !important; text-align: center; }',
    '.hr-tl { position: absolute; left: 50%; transform: translateX(-50%); top: calc(var(--hr-top) + var(--hr-vh) + 10px); width: var(--hr-vw);',
    '  height: 8px; background: #23232a; border-radius: 4px; cursor: pointer; }',
    '.hr-tl i { position: absolute; top: 0; bottom: 0; background: #4b4b55; border-radius: 2px; min-width: 3px; }',
    '.hr-tl i.seen { background: #77778a; } .hr-tl i.liked { background: #ff5c8a; } .hr-tl i.cur { background: #ffd45e; top: -2px; bottom: -2px; }',
    '.hr-tl u { position: absolute; top: -4px; bottom: -4px; width: 2px; background: #fff; border-radius: 1px; text-decoration: none; }',
    '.hr-card { position: absolute; left: 50%; transform: translateX(-50%); top: calc(var(--hr-top) + var(--hr-vh) + 30px); bottom: 44px;',
    '  width: clamp(600px, var(--hr-vw), calc(100vw - 120px)); display: flex; flex-direction: column; background: #16161a;',
    '  border: 1px solid #2a2a31; border-radius: 18px; padding: 14px 22px 12px; box-shadow: 0 20px 60px rgba(0,0,0,.45); overflow: hidden; }',
    '.hr-card.in-up { animation: hrUp .32s cubic-bezier(.2,.8,.2,1); } .hr-card.in-down { animation: hrDown .32s cubic-bezier(.2,.8,.2,1); }',
    '.hr-card.bump { animation: hrBump .3s; }',
    '@keyframes hrUp { from { opacity: 0; transform: translate(-50%, 60px); } to { opacity: 1; transform: translate(-50%, 0); } }',
    '@keyframes hrDown { from { opacity: 0; transform: translate(-50%, -60px); } to { opacity: 1; transform: translate(-50%, 0); } }',
    '@keyframes hrBump { 0%,100% { transform: translate(-50%, 0); } 40% { transform: translate(-50%, -10px); } }',
    '.hr-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: #a29e96; }',
    '.hr-pos { font: 700 16px ui-monospace, monospace; color: #fff; letter-spacing: -.02em; }',
    '.hr-pos small { font-size: 13px; color: #8f8b84; font-weight: 500; }',
    '.hr-why { font: 700 10.5px/1.7 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .07em; padding: 0 8px; border-radius: 999px; color: #111; }',
    '.hr-stars { color: #ffd45e; letter-spacing: 1px; font-size: 12px; }',
    '.hr-time { margin-left: auto; font: 13px ui-monospace, monospace; color: #cfcbc3; white-space: nowrap; }',
    '.hr-chap { font-size: 12.5px; color: #85817a; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.hr-text { flex: 1 1 0; min-height: 0; overflow: hidden; margin-top: 8px; font: clamp(19px, 1.9vw, 25px)/1.55 Georgia, "Iowan Old Style", serif;',
    '  color: #8d8982; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 26px), transparent 100%); padding: 8px 2px 24px; }',
    '.hr-text span { cursor: pointer; border-radius: 3px; transition: color .12s; }',
    '.hr-text span.said { color: #f4f2ec; }',
    '.hr-text span.now { color: #121212; background: #ffd45e; box-shadow: 0 0 0 2px #ffd45e; }',
    '.hr-text .q { color: #5f5b55; }',
    '.hr-prog { height: 3px; background: #2a2a31; border-radius: 2px; margin-top: 6px; overflow: hidden; flex: none; }',
    '.hr-prog i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffb35c, #ff5c8a); }',
    '.hr-foot { display: flex; align-items: center; gap: 8px; margin-top: 9px; font-size: 12.5px; color: #8f8b84; flex: none; }',
    '.hr-foot .sp { flex: 1; }',
    '.hr-like.on { background: #ff5c8a; border-color: #ff5c8a; color: #fff; }',
    '.hr-pop { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%) scale(.4); font-size: 90px; color: #ff5c8a; opacity: 0;',
    '  pointer-events: none; text-shadow: 0 6px 30px rgba(255,92,138,.5); }',
    '.hr-pop.go { animation: hrPop .7s ease-out; }',
    '@keyframes hrPop { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.4); } 30% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }',
    '  100% { opacity: 0; transform: translate(-50%, -70%) scale(1); } }',
    '.hr-rail { position: absolute; right: 22px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 5px;',
    '  max-height: calc(100vh - 140px); }',
    '.hr-rail b { width: 6px; flex: 0 1 16px; min-height: 4px; border-radius: 3px; background: #3a3a43; cursor: pointer; transition: all .2s; }',
    '.hr-rail b:hover { background: #8f8b84; } .hr-rail b.seen { background: #6b6b78; } .hr-rail b.liked { background: #ff5c8a; }',
    '.hr-rail b.cur { width: 10px; flex-basis: 30px; background: #ffd45e; }',
    '.hr-rail .rl { font: 11px ui-monospace, monospace; color: #8f8b84; margin: 4px 0; }',
    '.hr-hint { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; font-size: 12px; color: #77736c; }',
    '.hr-hint span { margin: 0 7px; white-space: nowrap; }',
    '.hr-sumv { position: absolute; inset: 50px 0 0; overflow-y: auto; padding: 30px 20px 60px; }',
    '.hr-sumc { max-width: 760px; margin: 0 auto; }',
    '.hr-sumc h2 { font: 700 30px/1.25 system-ui, sans-serif; margin: 0 0 6px; letter-spacing: -.01em; }',
    '.hr-sumc .big { font: 600 19px/1.5 system-ui, sans-serif; color: #e8e5de; }',
    '.hr-sumc .big b { color: #ffd45e; }',
    '.hr-sumc .sub { color: #8f8b84; margin: 2px 0 22px; }',
    '.hr-sumc h3 { font: 700 12px system-ui, sans-serif; text-transform: uppercase; letter-spacing: .08em; color: #ff8fb0; margin: 26px 0 10px; }',
    '.hr-sumc h3.all { color: #8f8b84; }',
    '.hr-li { background: #16161a; border: 1px solid #2a2a31; border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; }',
    '.hr-li .lt { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: #a29e96; }',
    '.hr-li .lt .tm { font: 13px ui-monospace, monospace; color: #ffd45e; }',
    '.hr-li .lq { font: 17px/1.5 Georgia, serif; color: #e8e5de; margin: 6px 0 8px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }',
    '.hr-li .lb { display: flex; gap: 8px; }',
    '.hr-row { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 13.5px; color: #cfcbc3; }',
    '.hr-row:hover { background: #1d1d22; } .hr-row .tm { font: 12.5px ui-monospace, monospace; color: #8f8b84; width: 64px; text-align: right; flex: none; }',
    '.hr-row .hv { color: #ff5c8a; width: 14px; flex: none; } .hr-row.unseen { opacity: .55; }',
    '.hr-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px; }',
    '.hr-actions button { font-size: 14px; padding: 8px 16px; }',
    '.hr-actions button.pri { background: #ffd45e; color: #111; border-color: #ffd45e; }',
    '.hr-empty { color: #8f8b84; font-style: italic; }',
  ].join('\n'));

  var WHY = { claim: '#7dd3fc', story: '#fdba74', number: '#86efac', framing: '#c4b5fd', disagreement: '#fca5a5', insight: '#fde047', quote: '#f9a8d4' };
  var A = null, likes = [], order = 'time', R = null;

  function human(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), mm = m % 60;
    return h + ' h' + (mm ? ' ' + (mm < 10 ? '0' : '') + mm : '');
  }
  function spd(r) { return String(Math.round(r * 100) / 100); }
  function stars(n) { n = Math.max(0, Math.min(5, n | 0)); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function keyOf(h) { return h.startPara + ':' + h.startWord; }
  function isLiked(h) { var k = keyOf(h); return likes.some(function (x) { return keyOf(x) === k; }); }
  function chapterAt(t) { var c = null; T.chapters.forEach(function (x) { if (x.start <= t + 0.01) c = x; }); return c; }
  function sorted() {
    var list = A.highlights.slice();
    if (order === 'score') list.sort(function (a, b) { return (b.score - a.score) || (a.t0 - b.t0); });
    else list.sort(function (a, b) { return a.t0 - b.t0; });
    return list;
  }

  // ---------- saved state ----------
  store.get().then(function (o) {
    o = o || {};
    if (o.order === 'score') order = 'score';
    likes = (o[VKEY] && o[VKEY].likes) || [];
    drawGutter();
  });
  function saveLikes() { store.set(VKEY, { likes: likes }); drawGutter(); }
  var gutter = T.addGutterLayer('reel-likes');
  function drawGutter() {
    gutter.clear();
    likes.forEach(function (h) {
      var m = gutter.set(h.startPara, '♥', { title: 'Saved in the highlight reel (' + fmt(h.t0) + ')', onClick: function () { L.video.seek(h.t0); } });
      if (m) m.style.color = '#ff5c8a';
    });
  }

  // ---------- the reel ----------
  var box = null, card = null, wordsEls = [], tlEls = [], railEls = [];

  function open() {
    if (R) return;
    L.analysis.get().then(function (a) {
      A = a;
      if (!a || !a.highlights || !a.highlights.length) {
        L.ui.toast(a ? 'This analysis has no highlights.' : 'Analyze this video first (🧪 Analyze under the video) — the reel plays its highlights.', 4500);
        return;
      }
      var list = sorted(), now = L.video.time(), i = 0;
      if (order === 'time' && now > 30) {
        for (var k = 0; k < list.length; k++) if (list[k].t1 > now + 2) { i = k; break; }
        if (list[list.length - 1].t1 <= now + 2) i = 0;
      }
      L.mode.enter('reel', function () { close('quiet'); });   // one mode at a time: ends the sampler / Read mode
      R = { list: list, i: -1, before: { t: now, paused: L.video.paused() }, playMs: 0, lastTick: 0, seekAt: 0, seen: {}, prog: {}, reseeked: false,
            summary: false, lastF: -1, wheel: 0, wheelLock: false, wheelTimer: null };
      build();
      document.body.classList.add('hr-on');
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      box.focus();
      go(i, 1, true);
      if (i > 0) L.ui.toast('Starting at ' + (i + 1) + ' / ' + list.length + ' — where you are. ↑ for earlier ones.', 3000);
      R.timer = setInterval(tick, 100);
      L.log('highlight-reel: open at ' + (i + 1) + '/' + list.length + ' order=' + order);
    });
  }

  function close(how, t) {
    if (!R) return;
    var r = R;
    clearInterval(r.timer);
    R = null;
    L.mode.exit('reel');
    document.body.classList.remove('hr-on', 'hr-sum', 'hr-paused');
    if (box) box.remove();
    box = null;
    if (how === 'quiet') {   // ended by another mode (LABS.mode): leave the video to it
    } else if (how === 'back') {
      L.video.seek(r.before.t + 0.3, { play: !r.before.paused });
      L.ui.toast('Back at ' + fmt(r.before.t) + ' (where you were before the reel)', 2500);
    } else if (how === 'jump') {
      L.video.seek(t, { play: true });
      L.ui.toast('Watching from ' + fmt(t), 2000);
    } else {   // keep watching from here
      L.video.play();
      L.ui.toast('Keep watching from ' + fmt(L.video.time()), 2000);
    }
    L.log('highlight-reel: close ' + how + ' after ' + Math.round(r.playMs / 1000) + ' s');
  }

  function build() {
    if (box) box.remove();
    var v = L.video.box();
    if (v && !v.querySelector('.hr-shield')) {
      var sh = el('div', { class: 'hr-shield', title: 'Pause / play (Space)' }, [el('b', {}, ['▶'])]);
      sh.addEventListener('click', function () { if (R) L.video.toggle(); });
      sh.addEventListener('wheel', function (e) { onWheel(e); }, { passive: false });
      v.appendChild(sh);
    }
    box = el('div', { class: 'hr', tabindex: '-1' });
    var seg = el('div', { class: 'hr-seg' }, [
      el('button', { class: order === 'time' ? 'on' : '', title: 'In the order they were said (O)', onclick: function () { setOrder('time'); } }, ['In order']),
      el('button', { class: order === 'score' ? 'on' : '', title: 'Strongest first (O)', onclick: function () { setOrder('score'); } }, ['By score']),
    ]);
    box.appendChild(el('div', { class: 'hr-top' }, [
      el('span', { class: 'hr-brand' }, ['▶ Highlight reel']),
      el('span', { class: 'hr-title' }, [T.title || '']),
      seg,
      el('button', { title: 'Close the reel and keep watching the full video from here (Enter)', onclick: function () { close('keep'); } }, ['⏎ Keep watching']),
      el('button', { class: 'hr-x', title: 'Exit — back to where you were (Esc)', onclick: function () { close('back'); } }, ['✕']),
    ]));
    // full-video timeline with every highlight on it
    var tl = el('div', { class: 'hr-tl', title: 'The whole video — every highlight is a mark. Click a mark to play it.' });
    var dur = L.video.duration() || T.duration || 1;
    tlEls = R.list.map(function (h, k) {
      var m = el('i', { style: { left: (h.t0 / dur * 100) + '%', width: ((h.t1 - h.t0) / dur * 100) + '%' } });
      m.addEventListener('click', function (e) { e.stopPropagation(); go(k, k > R.i ? 1 : -1); });
      tl.appendChild(m); return m;
    });
    tl.appendChild(R.head = el('u', { style: { left: '0%' } }));
    box.appendChild(tl);
    // the rail: one bar per highlight
    var rail = el('div', { class: 'hr-rail' });
    rail.appendChild(R.railTop = el('span', { class: 'rl' }, ['']));
    railEls = R.list.map(function (h, k) {
      var b = el('b', { title: (k + 1) + ' · ' + fmt(h.t0) });
      b.addEventListener('click', function () { go(k, k > R.i ? 1 : -1); });
      rail.appendChild(b); return b;
    });
    box.appendChild(rail);
    box.appendChild(card = el('div', { class: 'hr-card' }));
    box.appendChild(el('div', { class: 'hr-hint' }, [
      hint(['↓', 'J'], 'next'), hint(['↑', 'K'], 'previous'), hint(['Space'], 'pause'), hint(['L'], 'save'), hint(['O'], 'order'),
      hint(['⏎'], 'keep watching'), hint(['Esc'], 'exit'), hint(['S', 'D'], 'speed'),
    ]));
    box.addEventListener('wheel', onWheel, { passive: false });
    document.body.appendChild(box);
  }
  function hint(keys, what) {
    var s = el('span');
    keys.forEach(function (k) { s.append(el('kbd', {}, [k]), ' '); });
    s.append(what);
    return s;
  }

  function setOrder(o) {
    if (!R || o === order) return;
    var cur = R.list[R.i];
    order = o;
    store.set('order', o);
    R.list = sorted();
    var seenKeys = {};
    Object.keys(R.seen).forEach(function (k) { seenKeys[keyOf(R.seen[k])] = R.seen[k]; });
    R.seen = {};
    R.list.forEach(function (h, k) { if (seenKeys[keyOf(h)]) R.seen[k] = h; });
    var i = cur ? R.list.indexOf(cur) : 0;
    var wasSummary = R.summary;
    R.summary = false;
    build();
    box.focus();
    if (wasSummary) { go(0, 1, true); } else { R.i = -1; go(i, 1, true, true); }
    L.ui.toast(o === 'score' ? 'By score: strongest first' : 'In order: as they were said', 1800);
  }

  // show highlight k (dir: 1 = from below, -1 = from above); noSeek keeps the playhead (order change)
  function go(k, dir, first, noSeek) {
    if (!R) return;
    if (k < 0) { bump(); return; }
    if (k >= R.list.length) { summary(); return; }
    if (R.summary) { R.summary = false; build(); box.focus(); }
    document.body.classList.remove('hr-sum');
    var h = R.list[k];
    R.i = k; R.seen[k] = h; R.reseeked = false; R.lastF = -1;
    if (!noSeek) { L.video.seek(h.t0, { play: true }); R.seekAt = performance.now(); }
    renderCard(h, k);
    if (!first || dir) { card.classList.remove('in-up', 'in-down'); void card.offsetWidth; card.classList.add(dir < 0 ? 'in-down' : 'in-up'); }
    tlEls.forEach(function (m, j) { m.className = (j === k ? 'cur' : '') + (R.seen[j] ? ' seen' : '') + (isLiked(R.list[j]) ? ' liked' : ''); });
    railEls.forEach(function (b, j) { b.className = (j === k ? 'cur' : '') + (R.seen[j] ? ' seen' : '') + (isLiked(R.list[j]) ? ' liked' : ''); });
    R.railTop.textContent = (k + 1) + '/' + R.list.length;
  }
  function bump() { if (!card) return; card.classList.remove('in-up', 'in-down', 'bump'); void card.offsetWidth; card.classList.add('bump'); L.ui.toast('This is the first highlight', 1200); }

  function renderCard(h, k) {
    card.textContent = '';
    var ch = chapterAt(h.t0);
    var why = String(h.why || '');
    card.appendChild(el('div', { class: 'hr-meta' }, [
      el('span', { class: 'hr-pos' }, [String(k + 1), el('small', {}, [' / ' + R.list.length])]),
      h.label ? L.ui.label(h.label) : null,
      why ? el('span', { class: 'hr-why', style: { background: WHY[why] || '#d6d3cc' }, title: 'Why the AI picked it' }, [why]) : null,
      el('span', { class: 'hr-stars', title: 'AI score ' + h.score + ' / 5' }, [stars(h.score)]),
      el('span', { class: 'hr-time' }, [fmt(h.t0) + ' – ' + fmt(h.t1) + '  ·  ' + human(h.t1 - h.t0)]),
    ]));
    if (ch) card.appendChild(el('div', { class: 'hr-chap' }, ['in chapter · ' + ch.title]));
    // the exact words, one span per word (each from LABS.transcript.text), so the spoken word can be marked
    var tx = el('div', { class: 'hr-text' });
    wordsEls = [];
    tx.appendChild(el('span', { class: 'q' }, ['“']));
    T.eachWord(h, function (p, w) {
      var s = el('span', {}, [T.text({ startPara: p, startWord: w, endPara: p, endWord: w })]);
      s._f = T.flat(p, w); s._t = T.paragraphs[p].times[w];
      s.addEventListener('click', function () { L.video.seek(s._t + 0.3, { play: true }); R && (R.seekAt = performance.now()); });
      tx.appendChild(s); tx.appendChild(document.createTextNode(' '));
      wordsEls.push(s);
    });
    tx.appendChild(el('span', { class: 'q' }, ['”']));
    card.appendChild(tx);
    R.textEl = tx;
    var prog = el('div', { class: 'hr-prog' }, [R.progEl = el('i')]);
    card.appendChild(prog);
    var liked = isLiked(h);
    R.likeBtn = el('button', { class: 'hr-like' + (liked ? ' on' : ''), title: 'Save this moment (L)', onclick: function () { toggleLike(); } }, [liked ? '♥ Saved' : '♡ Save']);
    R.statusEl = el('span', {}, ['']);
    card.appendChild(el('div', { class: 'hr-foot' }, [
      R.likeBtn,
      el('button', { title: 'Close the reel and keep watching the full video from here (Enter)', onclick: function () { close('keep'); } }, ['⏎ Keep watching from here']),
      el('span', { class: 'sp' }),
      R.statusEl,
    ]));
    card.appendChild(R.pop = el('div', { class: 'hr-pop' }, ['♥']));
  }

  function toggleLike() {
    if (!R || R.summary) return;
    var h = R.list[R.i], k = keyOf(h);
    if (isLiked(h)) {
      likes = likes.filter(function (x) { return keyOf(x) !== k; });
      L.ui.toast('Removed from saved moments', 1200);
    } else {
      likes.push({ startPara: h.startPara, startWord: h.startWord, endPara: h.endPara, endWord: h.endWord, t0: h.t0, t1: h.t1,
                   label: h.label, why: h.why, score: h.score, savedAt: new Date().toISOString() });
      likes.sort(function (a, b) { return a.t0 - b.t0; });
      R.pop.classList.remove('go'); void R.pop.offsetWidth; R.pop.classList.add('go');
    }
    saveLikes();
    var on = isLiked(h);
    R.likeBtn.classList.toggle('on', on); R.likeBtn.textContent = on ? '♥ Saved' : '♡ Save';
    tlEls[R.i].classList.toggle('liked', on); railEls[R.i].classList.toggle('liked', on);
  }

  function tick() {
    if (!R) return;
    var nowMs = performance.now(), paused = L.video.paused(), t = L.video.time();
    if (!R.summary && !paused && R.lastTick) R.playMs += Math.min(1000, nowMs - R.lastTick);
    R.lastTick = nowMs;
    document.body.classList.toggle('hr-paused', paused && !R.summary);
    if (R.summary) return;
    var dur = L.video.duration() || T.duration || 1;
    R.head.style.left = Math.min(100, t / dur * 100) + '%';
    var h = R.list[R.i], since = nowMs - R.seekAt, len = Math.max(0.1, h.t1 - h.t0);
    var fr = Math.max(0, Math.min(1, (t - h.t0) / len));
    R.progEl.style.width = fr * 100 + '%';
    if (since > 900 && t <= h.t1 + 2 && fr > (R.prog[keyOf(h)] || 0)) R.prog[keyOf(h)] = t >= h.t1 - 0.05 ? 1 : fr;
    R.statusEl.textContent = (paused ? '❚❚ paused' : '▶ ' + spd(L.video.speed()) + '×') +
      ' · ' + human(Math.max(0, h.t1 - t) / Math.max(0.1, L.video.speed())) + ' left';
    if (since > 900) {
      if (!paused && t >= h.t1 - 0.05 && t < h.t1 + 25) { go(R.i + 1, 1); return; }
      // the player is somewhere else (a stale position, an ad, a click under the reel): back to this highlight, once
      if (since > 2500 && !R.reseeked && (t < h.t0 - 4 || t > h.t1 + 25)) { R.reseeked = true; L.video.seek(h.t0, { play: !paused }); R.seekAt = nowMs; return; }
    }
    // the word being said
    if (t >= h.t0 - 1 && t <= h.t1 + 1) {
      var a = T.at(t), f = T.flat(a.para, a.word);
      if (f !== R.lastF) {
        R.lastF = f;
        var cur = null;
        wordsEls.forEach(function (s) { s.classList.toggle('said', s._f < f); var n = s._f === f; s.classList.toggle('now', n); if (n) cur = s; });
        if (cur) keepWordInView(cur);
      }
    }
  }
  function keepWordInView(s) {
    var box2 = R.textEl, y = s.offsetTop - box2.offsetTop, hgt = box2.clientHeight;
    if (y < box2.scrollTop + 10 || y > box2.scrollTop + hgt * 0.55) box2.scrollTo({ top: Math.max(0, y - hgt * 0.3), behavior: 'smooth' });
  }

  // ---------- the end ----------
  function summary() {
    if (!R) return;
    R.summary = true;
    L.video.pause();
    document.body.classList.add('hr-sum');
    document.body.classList.remove('hr-paused');
    var total = R.list.reduce(function (s, h) { return s + (h.t1 - h.t0); }, 0);
    var dur = L.video.duration() || T.duration || 0;
    var seenN = R.list.filter(function (h) { return (R.prog[keyOf(h)] || 0) >= 0.8; }).length;
    box.textContent = '';
    box.appendChild(el('div', { class: 'hr-top' }, [
      el('span', { class: 'hr-brand' }, ['▶ Highlight reel']), el('span', { class: 'hr-title' }, [T.title || '']),
      el('button', { class: 'hr-x', title: 'Exit — back to where you were (Esc)', onclick: function () { close('back'); } }, ['✕']),
    ]));
    var c = el('div', { class: 'hr-sumc' });
    c.appendChild(el('h2', {}, ['That’s the reel.']));
    c.appendChild(el('div', { class: 'big' }, [
      el('b', {}, [R.list.length + ' highlights']), ' · ', el('b', {}, [human(total)]), ' of ' + human(dur) +
      ' · watched in ', el('b', {}, [human(R.playMs / 1000)]),
    ]));
    c.appendChild(el('div', { class: 'sub' }, [
      'You watched ' + seenN + ' of ' + R.list.length + ' to the end' + (seenN < R.list.length ? ' (swiped past ' + (R.list.length - seenN) + ')' : '') + ' · at ' + spd(L.video.speed()) + '× · ' + Math.round(total / Math.max(1, dur) * 100) + '% of the video',
    ]));
    var mine = R.list.map(function (h, k) { return { h: h, k: k }; }).filter(function (x) { return isLiked(x.h); });
    c.appendChild(el('h3', {}, ['♥ Saved moments (' + likes.length + ')']));
    if (!likes.length) c.appendChild(el('div', { class: 'hr-empty' }, ['Nothing saved this time — press L during a highlight to save it.']));
    likes.forEach(function (h) {
      var inReel = -1;
      mine.forEach(function (x) { if (keyOf(x.h) === keyOf(h)) inReel = x.k; });
      c.appendChild(el('div', { class: 'hr-li' }, [
        el('div', { class: 'lt' }, [el('span', { class: 'tm' }, [fmt(h.t0) + ' – ' + fmt(h.t1)]), h.label ? L.ui.label(h.label) : null,
          (chapterAt(h.t0) || {}).title ? el('span', {}, ['in · ' + chapterAt(h.t0).title]) : null]),
        el('div', { class: 'lq' }, ['“' + T.text(h) + '”']),
        el('div', { class: 'lb' }, [
          el('button', { class: 'on', title: 'Close the reel and watch the full video from this moment', onclick: function () { close('jump', h.t0); } }, ['▶ Jump in here']),
          inReel >= 0 ? el('button', { title: 'Play this highlight again in the reel', onclick: function () { go(inReel, -1); } }, ['↺ Replay in the reel']) : null,
          el('button', { title: 'Remove from saved moments', onclick: function () {
            likes = likes.filter(function (x) { return keyOf(x) !== keyOf(h); }); saveLikes(); summary();
          } }, ['Remove']),
        ]),
      ]));
    });
    c.appendChild(el('h3', { class: 'all' }, ['All highlights']));
    R.list.forEach(function (h, k) {
      var row = el('div', { class: 'hr-row' + (R.seen[k] ? '' : ' unseen'), title: 'Play it in the reel' }, [
        el('span', { class: 'tm' }, [fmt(h.t0)]), el('span', { class: 'hv' }, [isLiked(h) ? '♥' : '']),
        h.label ? L.ui.label(h.label) : el('span', {}, ['highlight ' + (k + 1)]),
        el('span', { style: { color: '#77736c', fontSize: '12px' } }, [human(h.t1 - h.t0)]),
      ]);
      row.addEventListener('click', function () { go(k, -1); });
      c.appendChild(row);
    });
    var last = R.list[R.list.length - 1];
    c.appendChild(el('div', { class: 'hr-actions' }, [
      el('button', { class: 'pri', onclick: function () { R.seen = {}; R.prog = {}; R.playMs = 0; go(0, 1); } }, ['↺ Watch the reel again']),
      el('button', { title: 'Esc', onclick: function () { close('back'); } }, ['Back to where I was · ' + fmt(R.before.t)]),
      el('button', { title: 'Enter', onclick: function () { close('jump', last.t1); } }, ['Keep watching after the last highlight · ' + fmt(last.t1)]),
    ]));
    box.appendChild(el('div', { class: 'hr-sumv' }, [c]));
    box.focus();
    L.log('highlight-reel: summary seen=' + seenN + ' liked=' + likes.length + ' playMs=' + Math.round(R.playMs));
  }

  // ---------- keys & wheel (only while the reel is open; the app's keys are untouched otherwise) ----------
  var PASS = { s: 1, d: 1, r: 1, g: 1, v: 1, z: 1, x: 1 };   // speed and ±5 s still work inside the reel
  window.addEventListener('keydown', function (e) {
    if (!R) return;
    if (e.metaKey || e.ctrlKey || e.altKey) { if (e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var act = null;
    if (R.summary) {
      act = { Escape: function () { close('back'); }, Enter: function () { close('jump', R.list[R.list.length - 1].t1); },
              ArrowUp: function () { go(R.list.length - 1, -1); }, ArrowLeft: function () { go(R.list.length - 1, -1); }, k: function () { go(R.list.length - 1, -1); },
              o: function () { setOrder(order === 'time' ? 'score' : 'time'); } }[k];
    } else {
      act = {
        ArrowDown: next, ArrowRight: next, j: next, ArrowUp: prev, ArrowLeft: prev, k: prev,
        ' ': function () { L.video.toggle(); }, Enter: function () { close('keep'); }, Escape: function () { close('back'); },
        l: toggleLike, o: function () { setOrder(order === 'time' ? 'score' : 'time'); },
      }[k];
    }
    if (!act && !R.summary && PASS[k] && !e.shiftKey) return;   // let the app handle speed / skip keys
    if (k === '?') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (act && !e.repeat) act(); else if (act && (k === 'ArrowDown' || k === 'ArrowUp' || k === 'j' || k === 'k')) act();
  }, true);
  function next() { go(R.i + 1, 1); }
  function prev() { go(R.i - 1, -1); }
  function onWheel(e) {
    if (!R || R.summary) return;   // the summary scrolls normally
    e.preventDefault();
    clearTimeout(R.wheelTimer);
    R.wheelTimer = setTimeout(function () { if (R) { R.wheelLock = false; R.wheel = 0; } }, 220);   // a pause in the stream ends a swipe
    if (R.wheelLock) return;
    R.wheel += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(R.wheel) > 45) { R.wheelLock = true; var d = R.wheel; R.wheel = 0; if (d > 0) next(); else prev(); }
  }

  // ---------- entry points ----------
  var btn = L.ui.addButton({ id: 'hrOpen', label: '▶ Reel', title: 'Highlight reel: the AI highlights back to back, TikTok-style (E)', onClick: open });
  L.ui.addKey('e', open, 'Highlight reel (Labs)');
  function showCount(a) { btn.textContent = a && a.highlights && a.highlights.length ? '▶ Reel · ' + a.highlights.length : '▶ Reel'; }
  // Opened with #labs=reel (the board's ▶ Reel button, triage-cards): go straight into the reel once the analysis is here.
  function launchReel() {
    if (!L.launch || !L.launch.has('reel') || R) return;
    if (A && A.highlights && A.highlights.length) { L.launch.clear(); open(); }
  }
  L.analysis.get().then(function (a) { A = a; showCount(a); launchReel(); });
  L.analysis.onChange(function (a) { A = a; showCount(a); launchReel(); });
  if (L.launch) L.launch.onChange(launchReel);
  window.LABS_highlightReel = { open: open, close: close, state: function () { return R && { i: R.i, n: R.list.length, summary: R.summary, playMs: R.playMs, order: order }; }, likes: function () { return likes; } };
})();
