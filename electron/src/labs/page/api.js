// window.LABS — the page API for player experiments (Labs flavor only; served as part of /labs/boot.js).
// Built on window.FA_INTERNAL, which player.html exposes once the transcript is rendered. Experiments
// (src/labs/experiments/<id>/player.js) use ONLY this API, so player.html can change without breaking them.
// Full reference: docs/labs.md ("The page API").
//
// A span is { startPara, startWord, endPara, endWord } (inclusive, paragraph-local word numbers into the
// transcript's .follow-along.json words). The only text an experiment may show for a span is LABS.transcript.text(span)
// — never text that came from a model. AI-written labels (≤ 6 words) must be shown with LABS.ui.label(text).
/* eslint-disable */
(function () {
  'use strict';
  function makeLabs(F, config) {
    var DATA = F.DATA, paraEls = F.paraEls, wordEls = F.wordEls;
    var listeners = { tick: [], analysis: [] };
    var styleOnce = {};
    function el(tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class' || k === 'className') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v));
      });
      (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : String(c)); });
      return e;
    }
    function css(id, text) {
      if (styleOnce[id]) return styleOnce[id];
      var s = el('style', { 'data-labs': id }); s.textContent = text; document.head.appendChild(s); styleOnce[id] = s; return s;
    }
    css('labs-base', [
      '.labs-hl { background: rgba(124, 92, 255, .16); border-radius: 2px; }',
      '.labs-gutter { position: absolute; right: calc(100% + 4px); top: 0; display: flex; gap: 2px; font: 11px/2.4 system-ui, sans-serif; white-space: nowrap; }',
      '.labs-label { display: inline-block; font: 600 10.5px/1.5 system-ui, sans-serif; letter-spacing: .02em; color: #6d4bd8; border: 1px dashed #8c6cf0; border-radius: 4px; padding: 0 5px; white-space: nowrap; }',
      '.labs-label::before { content: "AI label · "; font-weight: 400; opacity: .75; }',
      '@media (prefers-color-scheme: dark) { .labs-label { color: #b9a4ff; border-color: #8c6cf0; } }',
      '.bar .labsbtn { border-color: #8c6cf0; }',
      '.labs-ro { display: inline-block; margin-left: 6px; font: 600 10.5px/1.6 system-ui, sans-serif; color: #6d4bd8; border: 1px solid #8c6cf0; border-radius: 999px; padding: 0 7px; vertical-align: 1px; }',
    ].join('\n'));

    // ---------- transcript ----------
    var paragraphs = DATA.paras.map(function (p, i) { return { index: i, turn: !!p.turn, start: DATA.t[i][0], words: p.w, times: DATA.t[i] }; });
    var offsets = [], total = 0;
    paragraphs.forEach(function (p) { offsets.push(total); total += p.words.length; });
    function flat(p, w) { return offsets[p] + w; }
    function pos(f) {
      f = Math.max(0, Math.min(total - 1, f));
      var lo = 0, hi = offsets.length - 1, p = 0;
      while (lo <= hi) { var m = (lo + hi) >> 1; if (offsets[m] <= f) { p = m; lo = m + 1; } else hi = m - 1; }
      return [p, f - offsets[p]];
    }
    function eachWord(span, fn) {
      var a = flat(span.startPara, span.startWord), b = flat(span.endPara, span.endWord);
      for (var f = a; f <= b && f < total; f++) { var q = pos(f); fn(q[0], q[1]); }
    }
    function text(span) { var out = []; eachWord(span, function (p, w) { out.push(DATA.paras[p].w[w]); }); return out.join(' '); }
    function spanTimes(span) {
      var b = flat(span.endPara, span.endWord), e = pos(b), next = b + 1 < total ? pos(b + 1) : null;
      var t1 = next ? Math.min(DATA.t[next[0]][next[1]], DATA.t[e[0]][e[1]] + 3) : DATA.t[e[0]][e[1]] + 0.6;
      return { t0: DATA.t[span.startPara][span.startWord], t1: t1 };
    }
    function lastLE(arr, x) { var lo = 0, hi = arr.length - 1, r = 0; while (lo <= hi) { var m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
    function at(time) { var p = lastLE(F.starts, time); return { para: p, word: lastLE(DATA.t[p], time) }; }

    function highlightRange(span, opts) {
      opts = opts || {};
      var cls = opts.className || 'labs-hl', touched = [];
      eachWord(span, function (p, w) {
        var e = wordEls[p][w]; e.classList.add(cls);
        if (opts.color) e.style.background = opts.color;
        if (opts.title) e.title = opts.title;
        touched.push(e);
      });
      return { remove: function () { touched.forEach(function (e) { e.classList.remove(cls); if (opts.color) e.style.background = ''; if (opts.title) e.removeAttribute('title'); }); touched = []; } };
    }

    var gutterLayers = {};
    function addGutterLayer(name) {
      if (gutterLayers[name]) return gutterLayers[name];
      var marks = [];
      var layer = {
        set: function (p, content, o) {
          o = o || {};
          var t = paraEls[p] && paraEls[p].querySelector('.t'); if (!t) return null;
          var box = t.querySelector('.labs-gutter');
          if (!box) { box = el('span', { class: 'labs-gutter' }); t.appendChild(box); }
          var m = el('span', { 'data-layer': name, title: o.title || null }, [content]);
          if (o.onClick) m.addEventListener('click', function (e) { e.stopPropagation(); o.onClick(e); });
          m.addEventListener('mousedown', function (e) { e.stopPropagation(); });
          box.appendChild(m); marks.push(m); return m;
        },
        clear: function () { marks.forEach(function (m) { m.remove(); }); marks = []; },
        remove: function () { layer.clear(); delete gutterLayers[name]; },
      };
      gutterLayers[name] = layer;
      return layer;
    }

    // ---------- video ----------
    var video = {
      time: function () { return F.now(); },
      duration: function () { return DATA.duration || F.P.dur || 0; },
      rate: function () { return F.P.rate; },
      speed: function () { return F.getSpeed(); },
      paused: function () { return F.P.paused; },
      seek: function (t, o) { o = o || {}; F.seekTo(Math.max(0, t - 0.3), o.play !== false); if (o.follow !== false) F.setFollow(true); },
      play: function () { if (F.P.paused) F.togglePlay(); },
      pause: function () { F.pause(); },
      toggle: function () { F.togglePlay(); },
      setRate: function (r) { F.setSpeed(r); },
      onTick: function (fn, ms) {
        var id = setInterval(function () { try { var s = F.state(); fn({ t: F.now(), rate: F.P.rate, paused: F.P.paused, para: s.para, word: s.word, chapter: s.chapter }); } catch (e) { LABS.log('tick error', String(e)); } }, ms || 250);
        return function () { clearInterval(id); };
      },
    };

    // ---------- analysis (labs-analysis.json from Labs' userData, via the session server) ----------
    var analysisCache, signalsCache;
    var analysis = {
      get: function () {
        if (!analysisCache) analysisCache = fetch('/labs/analysis.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        return analysisCache;
      },
      refresh: function () { analysisCache = null; return analysis.get().then(function (a) { listeners.analysis.forEach(function (f) { try { f(a); } catch (e) {} }); return a; }); },
      onChange: function (fn) { listeners.analysis.push(fn); return function () { listeners.analysis = listeners.analysis.filter(function (f) { return f !== fn; }); }; },
      status: function () { return fetch('/labs/analyze/status', { cache: 'no-store' }).then(function (r) { return r.json(); }); },
      run: function (o) { return fetch('/labs/analyze' + (o && o.force ? '?force=1' : ''), { method: 'POST' }).then(function (r) { return r.json(); }); },
      signals: function () {
        if (!signalsCache) signalsCache = fetch('/labs/signals.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        return signalsCache;
      },
      refreshSignals: function () { signalsCache = null; return analysis.signals(); },
    };

    // ---------- panel tabs, buttons, keys ----------
    var ui = {
      toast: function (m, ms) { F.toast(m, ms); },
      actionToast: function (m, label, fn) { F.actionToast(m, label, fn); },
      addButton: function (o) {
        var b = el('button', { id: o.id || null, title: o.title || null, class: 'labsbtn' }, [o.label]);
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.onclick = function (e) { o.onClick && o.onClick(e); };
        var keys = document.getElementById('keysbtn');
        keys.parentNode.insertBefore(b, keys);
        return b;
      },
      addKey: function (key, fn, description) { return F.addKey(String(key).toLowerCase(), fn, description); },
      css: function (textOrId, maybeText) { return maybeText === undefined ? css('x' + Math.random(), textOrId) : css(textOrId, maybeText); },
      el: el,
      fmt: F.fmt,
      /** An AI-written label (≤ 6 words), visibly marked as one. */
      label: function (t) { return el('span', { class: 'labs-label', title: 'Written by the AI as a pointer — not a quote' }, [t]); },
    };

    function store(id) {
      var base = '/labs/state/' + encodeURIComponent(id);
      return {
        get: function (key) { return fetch(base, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) { return key === undefined ? o : o[key]; }); },
        set: function (key, value) { return fetch(base, { method: 'POST', body: JSON.stringify({ key: key, value: value }) }).then(function (r) { return r.json(); }); },
      };
    }

    var LABS = {
      version: 1,
      flavor: config.flavor,
      readOnly: !!config.readOnly,
      config: config,
      log: function () { F.native({ type: 'labs', msg: Array.prototype.slice.call(arguments).map(String).join(' ') }); },
      enabled: function (id) { return config.enabled.indexOf(id) >= 0; },
      video: video,
      transcript: {
        id: DATA.id, title: DATA.title, channel: DATA.channel, duration: DATA.duration,
        paragraphs: paragraphs, chapters: (DATA.chapters || []).slice(), wordCount: total,
        text: text, spanTimes: spanTimes, at: at, eachWord: eachWord,
        flat: flat, pos: pos,
        current: function () { return F.state(); },
        paraEl: function (p) { return paraEls[p]; },
        wordEl: function (p, w) { return wordEls[p] && wordEls[p][w]; },
        scrollTo: function (p, w) { F.setFollow(false); var e = (wordEls[p] && wordEls[p][w || 0]) || paraEls[p]; if (e) F.keepInView(e, true); },
        highlightRange: highlightRange,
        addGutterLayer: addGutterLayer,
        addPanelTab: function (id, label, render) { return F.addPanelTab(id, label, function (box) { render(box, LABS); }); },
      },
      analysis: analysis,
      ui: ui,
      store: store,
    };
    return LABS;
  }
  window.__makeLabs = makeLabs;
})();
