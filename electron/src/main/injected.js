(function () {
  if (window.__followAlong) return 'already';   // once per document; the app re-injects on every load
  window.__followAlong = true;
  var host = location.hostname;
  if (window === window.top) return;
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return;
  if (location.pathname.indexOf('/embed/') !== 0) return;

  var wantRate = null, lastQualityTry = 0, lastErr = '', qualityDone = false;
  function video() { return document.querySelector('video.html5-main-video') || document.querySelector('video'); }
  function mp() { return document.getElementById('movie_player'); }
  function post(msg) { msg.fa = msg.fa || 'status'; try { window.parent.postMessage(msg, '*'); } catch (e) {} }

  // Sets the rate only when it differs, so the audio is re-timed once per change.
  function applyRate() {
    var v = video();
    if (v && wantRate && Math.abs(v.playbackRate - wantRate) > 0.001) {
      try { v.playbackRate = wantRate; } catch (e) {}
    }
  }

  function bestQuality() {
    var p = mp();
    if (!p || !p.getAvailableQualityLevels) return;
    var levels = (p.getAvailableQualityLevels() || []).filter(function (q) { return q && q !== 'auto'; });
    if (!levels.length) return;
    var best = levels[0];
    if (p.getPlaybackQuality && p.getPlaybackQuality() === best) { qualityDone = true; return; }
    try { if (p.setPlaybackQualityRange) p.setPlaybackQualityRange(best, best); } catch (e) {}
    try { if (p.setPlaybackQuality) p.setPlaybackQuality(best); } catch (e) {}
  }

  var hooked = null;
  function hook(v) {
    if (!v || v === hooked) return;
    hooked = v;
    v.addEventListener('ratechange', function () {
      var off = wantRate && Math.abs(v.playbackRate - wantRate) > 0.001;
      // Logged (debug log): every rate change, and whether it was not ours (then it is put back).
      post({ fa: 'event', ev: 'ratechange', rate: v.playbackRate, want: wantRate, reset: !!off, t: v.currentTime });
      if (off) setTimeout(applyRate, 0);
    });
    ['loadeddata', 'playing', 'canplay'].forEach(function (ev) { v.addEventListener(ev, applyRate); });
    v.addEventListener('loadstart', function () { qualityDone = false; });
    ['play', 'pause', 'waiting', 'ended'].forEach(function (ev) {
      v.addEventListener(ev, function () {
        post({ fa: 'event', ev: ev, t: v.currentTime, byApp: Date.now() - lastCmd < 1500,
               hidden: document.hidden, focus: document.hasFocus() });
      });
    });
  }
  var lastCmd = 0;
  ['mousedown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { post({ fa: 'event', ev: 'click-in-video' }); }, true);
  });

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object' || m.fa !== 'cmd') return;
    var v = video(), p = mp();
    if (typeof m.rate === 'number') { wantRate = m.rate; applyRate(); }
    if (typeof m.seek === 'number') {
      if (p && p.seekTo) p.seekTo(m.seek, true); else if (v) v.currentTime = m.seek;
    }
    if (m.play || m.pause || typeof m.seek === 'number') lastCmd = Date.now();
    if (m.play) { if (p && p.playVideo) p.playVideo(); else if (v) v.play(); }
    if (m.pause) { if (p && p.pauseVideo) p.pauseVideo(); else if (v) v.pause(); }
    setTimeout(applyRate, 0);
    tick();
  });

  function tick() {
    var v = video();
    hook(v);
    applyRate();
    var now = Date.now();
    // Ask for the best quality until the player has it, then leave it alone:
    // forcing it again later would switch streams mid-play (an audio glitch).
    if (!qualityDone && now - lastQualityTry > 1000) { lastQualityTry = now; bestQuality(); }
    var p = mp(), errEl = document.querySelector('.ytp-error');
    var err = errEl && errEl.offsetParent !== null ? (errEl.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200) : '';
    if (err !== lastErr) { lastErr = err; }
    post({
      fa: 'status',
      ok: !!v,
      t: v ? v.currentTime : 0,
      rate: v ? v.playbackRate : 0,
      paused: v ? v.paused : true,
      dur: v && isFinite(v.duration) ? v.duration : 0,
      w: v ? v.videoWidth : 0,
      h: v ? v.videoHeight : 0,
      q: p && p.getPlaybackQuality ? p.getPlaybackQuality() : '',
      ad: !!document.querySelector('.ad-showing'),
      err: err
    });
  }
  setInterval(tick, 60);

  // Hotkeys: our keys never reach YouTube (its own F = fullscreen, arrows, space...).
  var KEYS = { s: 1, d: 1, r: 1, g: 1, z: 1, x: 1, v: 1, n: 1, f: 1, h: 1, '?': 1, ' ': 1, arrowleft: 1, arrowright: 1 };
  function ours(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return false;
    return KEYS[(e.key || '').toLowerCase()] === 1;
  }
  window.addEventListener('keydown', function (e) {
    if (!ours(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    post({ fa: 'key', key: e.key, shift: e.shiftKey, repeat: e.repeat });
  }, true);
  ['keyup', 'keypress'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  });
})();
