// The ONE generic loader of player experiments (Labs flavor only; served as /labs/boot.js after api.js).
// Waits for player.html (window.FA_INTERNAL), reads /labs/config.json, builds window.LABS, adds the Labs basics
// (a "read-only" pill, the 🧪 Analyze button) and then loads /labs/x/<id>.js for every enabled player experiment,
// in registry order. A failing experiment is logged and skipped; the others still load.
/* eslint-disable */
(function () {
  'use strict';
  function ready(fn) {
    if (window.FA_INTERNAL) return fn(window.FA_INTERNAL);
    window.addEventListener('fa-ready', function () { fn(window.FA_INTERNAL); }, { once: true });
  }
  function load(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = src;
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.body.appendChild(s);
    });
  }
  ready(function (F) {
    fetch('/labs/config.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (config) {
      var LABS = window.LABS = window.__makeLabs(F, config);
      var el = LABS.ui.el;
      // read-only pill next to the video's meta line
      var meta = document.querySelector('.meta');
      if (meta && LABS.readOnly) meta.appendChild(el('span', { class: 'labs-ro', title: 'Yaseen Video Notes Labs never writes to your vault: notes, status and progress are not saved there.' }, ['LABS · read-only']));

      // 🧪 Analyze this video (the analysis engine; the inspector experiment shows the result)
      var btn = LABS.ui.addButton({ id: 'labsAnalyze', label: '🧪 Analyze', title: 'Analyze this video with Claude (extractive: highlights, pull quotes, questions, claims) — Labs only' });
      var poll = null;
      function show(st, a) {
        if (st && st.state === 'running') {
          var s = Math.round((Date.now() - Date.parse(st.startedAt)) / 1000);
          btn.textContent = '🧪 Analyzing… ' + LABS.ui.fmt(s); btn.disabled = true;
        } else {
          btn.disabled = false;
          btn.textContent = a ? '🧪 Analysis ✓' : st && st.state === 'failed' ? '🧪 Analyze (failed)' : '🧪 Analyze';
          btn.title = a ? 'Analyzed ' + new Date(a.createdAt).toLocaleString() + ' — ' + a.highlights.length + ' highlights. Click to see it; Shift-click to run again.'
            : st && st.error ? 'Last run failed: ' + st.error : btn.title;
        }
      }
      function watch() {
        clearInterval(poll);
        poll = setInterval(function () {
          LABS.analysis.status().then(function (st) {
            if (st.state === 'running') return show(st, null);
            clearInterval(poll); poll = null;
            if (st.state === 'failed') { show(st, null); LABS.ui.toast('Analysis failed: ' + st.error, 6000); return; }
            LABS.analysis.refresh().then(function (a) { show(st, a); if (a) LABS.ui.toast('🧪 Analysis ready: ' + a.highlights.length + ' highlights', 3000); });
          });
        }, 1000);
      }
      btn.onclick = function (e) {
        LABS.analysis.get().then(function (a) {
          if (a && !e.shiftKey) {
            if (LABS.enabled('analysis-inspector')) F.showPanel('analysis-inspector');
            else LABS.ui.toast(a.highlights.length + ' highlights · turn on "Analysis inspector" in 🧪 Labs to see them', 4000);
            return;
          }
          LABS.analysis.run({ force: !!a }).then(function (st) { show(st, null); watch(); });
        });
      };
      Promise.all([LABS.analysis.status(), LABS.analysis.get()]).then(function (r) { show(r[0], r[1]); if (r[0].state === 'running') watch(); });
      LABS.analysis.onChange(function (a) { LABS.analysis.status().then(function (st) { show(st, a); }); });

      // the experiments, one after another (registry order)
      var ids = config.enabled.filter(function (id) { return config.player.indexOf(id) >= 0; });
      ids.reduce(function (p, id) {
        return p.then(function () { return load('/labs/x/' + encodeURIComponent(id) + '.js').then(function (ok) { LABS.log(ok ? 'loaded ' + id : 'could not load ' + id); }); });
      }, Promise.resolve()).then(function () { F.native({ type: 'labs-ready', experiments: ids }); });
    }).catch(function (e) { F.native({ type: 'error', message: 'labs boot: ' + e }); });
  });
})();
