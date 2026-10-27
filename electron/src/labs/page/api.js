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
      '.bar .labsbtn { border-color: #8c6cf0; padding: 5px 9px; font-size: 13px; }',
      // many experiments add panel tabs: wrap them onto a second row instead of squeezing (emoji over the label) or cutting them off
      '.ptabs { flex-wrap: wrap; } .ptabs button { white-space: nowrap; flex: none; }',
      '.labs-icard { display: block; user-select: none; -webkit-user-select: none; }',   // added by slides (addInlineCard)
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
      // added by highlight-reel: the 16:9 box that holds the YouTube frame, so a focused layout can restyle it
      // (e.g. position: fixed). Never move it in the DOM — that reloads the frame.
      box: function () { return document.querySelector('.video'); },
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
      addRail: addRail, videoBadge: videoBadge, keyMode: keyMode,   // added by Agent A (see below)
      // added by mochi-candidates: text → the system clipboard (the app's own copy message, like "Copy note")
      copy: function (t) { F.native({ type: 'copy', text: String(t) }); },
    };

    // ---------- added by Agent A (signal-strip, coverage-map, smart-speed, chapter-sampler) ----------
    // addRail(id, { width, title }) → { el, timeAt(clientY), setWidth(px), remove() }: a thin vertical rail along the transcript's
    //   right edge — a minimap of the whole video (top = 0:00, bottom = the end). Rails of several experiments stand
    //   side by side; the transcript text keeps clear of them.
    // videoBadge(id) → el: a small dark badge over the top of the video, after the speed badge (empty = hidden).
    // keyMode(fn(key, event) → true when used) → off(): a temporary key handler that sees keys BEFORE the app
    //   (e.g. ←/→/Enter/Esc while a mode is on); typing in inputs and ⌘/⌃/⌥ combos are never passed to it.
    css('labs-agent-a', [
      '.labs-rails { position: absolute; top: 46px; bottom: 14px; right: 14px; z-index: 3; display: flex; gap: 4px; pointer-events: none; }',
      '.labs-rail { position: relative; height: 100%; pointer-events: auto; border-radius: 4px; }',
      '.rwrap.labs-railed .tx { padding-right: calc(32px + var(--labs-rails-w, 0px)); }',
      '.labs-vbadges { position: absolute; top: 10px; left: 72px; right: 56px; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px; pointer-events: none; }',
      '.labs-vbadge { font: 600 12.5px/1.45 system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.66); padding: 3px 8px; border-radius: 6px; pointer-events: auto; white-space: nowrap; }',
      '.labs-vbadge:empty { display: none; }',
    ].join('\n'));
    var railBox = null;
    function addRail(id, o) {
      o = o || {};
      if (!railBox) {
        var wrap = (paraEls[0] && paraEls[0].closest('.rwrap')) || document.body;
        railBox = el('div', { class: 'labs-rails' }); wrap.appendChild(railBox); wrap.classList.add('labs-railed');
      }
      var r = el('div', { class: 'labs-rail', 'data-rail': id, title: o.title || null, style: { width: (o.width || 12) + 'px' } });
      railBox.appendChild(r);
      function fit() { if (railBox.parentNode) railBox.parentNode.style.setProperty('--labs-rails-w', (railBox.children.length ? railBox.offsetWidth + 10 : 0) + 'px'); }
      fit();
      return {
        el: r,
        timeAt: function (clientY) { var b = r.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientY - b.top) / b.height)) * video.duration(); },
        setWidth: function (w) { r.style.width = w + 'px'; fit(); },
        remove: function () { r.remove(); fit(); },
      };
    }
    var badgeBox = null;
    function videoBadge(id) {
      if (!badgeBox) {
        var sp = document.getElementById('speed'), host = sp && sp.parentNode;
        badgeBox = el('div', { class: 'labs-vbadges' });
        if (host) host.appendChild(badgeBox); else { badgeBox.style.position = 'fixed'; document.body.appendChild(badgeBox); }
      }
      var b = el('div', { class: 'labs-vbadge', 'data-badge': id });
      badgeBox.appendChild(b);
      return b;
    }
    function keyMode(fn) {
      var h = function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey || /TEXTAREA|INPUT|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
        var k = (e.shiftKey ? 'shift+' : '') + String(e.key).toLowerCase();
        var used = false;
        try { used = fn(k, e); } catch (x) { LABS.log('keyMode error', String(x)); }
        if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
      };
      window.addEventListener('keydown', h, true);
      return function () { window.removeEventListener('keydown', h, true); };
    }

    // ---------- added by labs-integration: one mode at a time ----------
    // A "mode" takes over the player for a while: 'reel' (highlight-reel), 'sample' (chapter-sampler), 'read'
    // (pull-quotes Read mode). enter(name, endFn) first ends the mode that is on (calls its endFn, which must stop it
    // quietly, without seeking); exit(name) when a mode ends by itself; current() → name | null; onChange(fn(name|null)).
    // Background helpers stand still while a mode plays the video: smart-speed (reel, sample), dense-mode's
    // skip-while-playing (reel, sample), sponsor-skip (reel).
    var modeCur = null, modeEnd = null, modeFns = [];
    function modeNotify() { modeFns.forEach(function (f) { try { f(modeCur); } catch (e) {} }); }
    var mode = {
      enter: function (name, endFn) {
        if (modeCur && modeCur !== name) {
          var f = modeEnd; modeCur = null; modeEnd = null;
          try { if (f) f(name); } catch (e) { LABS.log('mode end error', String(e)); }
        }
        modeCur = name; modeEnd = endFn || null; modeNotify();
      },
      exit: function (name) { if (modeCur !== name) return; modeCur = null; modeEnd = null; modeNotify(); },
      current: function () { return modeCur; },
      onChange: function (fn) { modeFns.push(fn); return function () { modeFns = modeFns.filter(function (f) { return f !== fn; }); }; },
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
        // added by dense-mode: the scrolling transcript column; its parent is position: relative, so floating UI
        // can sit over the transcript (absolute, like the A−/A+ tools).
        scroller: function () { return document.getElementById('scroller'); },
        // added by slides: a block card inside paragraph p, just before its word w — like a note card (the words stay
        // one run; no paragraph element is created, so paragraph counting is untouched). Put NO text nodes in it (use
        // title / CSS attr() labels): a copied selection then never picks it up. → { el, remove() } | null
        addInlineCard: function (p, w, node) {
          var we = wordEls[p] && wordEls[p][Math.max(0, Math.min(wordEls[p].length - 1, w || 0))];
          if (!we || !node) return null;
          node.classList.add('labs-icard'); node.setAttribute('contenteditable', 'false');
          we.parentNode.insertBefore(node, we);
          return { el: node, remove: function () { node.remove(); } };
        },
        // added by notes-view: Follow on / off, exactly like the Follow button / F (on = the transcript jumps back to
        // the current word and "Back to now" hides; off = "Back to now" shows). A view over the transcript (the Notes
        // view) turns it off when the user scrolls it, and follows the video while it is on.
        setFollow: function (on) { F.setFollow(!!on); },
      },
      analysis: analysis,
      // added by mochi-candidates: the user's notes as the player shows them (read-only copies, sorted by time)
      notes: function () {
        return (F.notes ? F.notes() : []).map(function (n) {
          return { para: n.para, time: n.time, end: n.end == null ? null : n.end, t: n.t, text: n.text, quote: n.quote || null, category: n.category, resolved: !!n.resolved };
        });
      },
      ui: ui,
      store: store,
      // added by triage-cards: the launch flag(s) the video was opened with — `#labs=reel` (comma-separated, e.g.
      // `#labs=reel,x`) when the Triage board card / queue opens it straight into the highlight reel. flags() → ['reel'];
      // has('reel'); onChange(fn(flags)) also fires when an already open video is re-launched (hashchange); clear().
      launch: {
        flags: function () { var m = /(?:^#|&)labs=([a-z0-9,-]+)/.exec(location.hash); return m ? m[1].split(',').filter(Boolean) : []; },
        has: function (f) { return LABS.launch.flags().indexOf(f) >= 0; },
        onChange: function (fn) { var h = function () { fn(LABS.launch.flags()); }; window.addEventListener('hashchange', h); return function () { window.removeEventListener('hashchange', h); }; },
        clear: function () { history.replaceState(null, '', location.pathname + location.search); },
      },
      mode: mode,
    };
    return LABS;
  }
  window.__makeLabs = makeLabs;
})();
