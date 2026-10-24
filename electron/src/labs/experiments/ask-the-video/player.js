// Labs experiment "ask-the-video": a 🔎 Ask panel tab — "where do they talk about X?" → passages of the transcript,
// word for word (LABS.transcript.text), with their times; click = play from there. Two engines, chosen automatically:
//  ⚡ local (this file, instant, as you type): lexical search over paragraphs — light stemming, synonym groups,
//     typo / prefix matching, BM25 ranking with bonuses for covering every query word and for query words close
//     together; the best window of each paragraph is shown with the matching words marked; top 8.
//  🤖 AI (Enter): main.ts sends the question + the indexed transcript to `claude -p`; the answer is only spans,
//     validated like the analysis. When claude is not usable (e.g. logged out) the tab says so and keeps ⚡.
// The engine is pure and exported for the unit test when there is no window.LABS (engine.test.ts).
(function () {
  'use strict';

  // ======================= the local engine (pure) =======================
  var engine = (function () {
    function set(s) { var o = Object.create(null); s.split(/\s+/).forEach(function (w) { if (w) o[w] = true; }); return o; }
    var STOP = set('a an the and or but if of to in on at for with about from by as into onto over under than then so ' +
      'is are was were be been being am do does did doing done have has had having ' +
      'i me my mine myself you your yours he him his she her hers it its we us our ours they them their theirs ' +
      'this that these those there here what which who whom whose where when why how ' +
      'can could would should will shall may might must not no nor yes yeah yep ok okay oh um uh uhm hmm ah ' +
      'like just really very too also so such kind sort know mean think thing things stuff gonna wanna gotta ' +
      'get got go going goes went say said says saying talk talks talking talked tell told ' +
      'all any some more most much many lot lots out up down again well now even one way let actually basically literally guess ' +
      "i'm it's that's don't you're there's we're they're i've can't didn't doesn't isn't what's he's she's let's i'd you've we've won't wasn't aren't");
    // words that only mean "find the place" in a question ("the part where the guest discusses X")
    var QUERY_STOP = set('part parts bit section sections moment moments segment place places video podcast episode interview ' +
      'guy guys speaker speakers host guest guests find show explain explains explained explaining discuss discusses discussed discussing ' +
      'discussion mention mentions mentioned mentioning topic bring brings brought anything something someone');
    // synonym groups (any member finds the others, at a lower weight); multi-word members are phrases
    var SYN = [
      'ai|artificial intelligence|agi|superintelligence|llm|llms|machine learning|neural net|neural network|chatbot',
      'robot|robots|robotics|humanoid|optimus|android',
      'money|cash|dollar|dollars|currency|wealth|rich|income|salary|wage|wages',
      'job|jobs|work|employment|career|labor|labour|occupation|unemployment|workforce',
      'car|cars|vehicle|vehicles|automobile|tesla|self driving|autonomous driving|autopilot',
      'rocket|rockets|spacex|starship|launch|spacecraft|falcon',
      'space|mars|moon|orbit|planet|planets|interplanetary',
      'brain|brains|mind|neuralink|neuron|neurons',
      'death|die|dying|dead|mortality|kill|killed|killing',
      'child|children|kid|kids|baby|babies|birth rate|fertility|population collapse',
      'government|regulation|regulator|regulators|politics|political|politician|law|laws|congress',
      'energy|electricity|solar|battery|batteries|grid|power plant',
      'cost|costs|price|prices|cheap|cheaper|expensive|afford|affordable',
      'happy|happiness|joy|meaning|purpose|fulfillment|fulfilling|meaningful',
      'war|wars|conflict|military|weapon|weapons|army|nuclear',
      'china|chinese|beijing|ccp',
      'america|american|americans|united states|usa',
      'education|school|schools|learn|learning|teach|teacher|university|college',
      'health|medicine|medical|doctor|doctors|disease|longevity|aging|ageing',
      'fear|afraid|scary|scared|risk|risks|danger|dangerous|threat|worried|worry',
      'future|prediction|predict|predictions|forecast',
      'chip|chips|semiconductor|semiconductors|gpu|gpus|nvidia',
      'compute|data center|datacenter|data centers|cluster|training run',
      'universal basic income|ubi|basic income|universal high income',
      'alignment|aligned|ai safety|safe|safety',
      'truth|truthful|honest|honesty|lie|lies|lying',
      'incentive|incentives|reward|rewards|motivation|motivated',
      'book|books|read|reading|author|novel',
      'startup|startups|company|companies|business|founder|founders|entrepreneur',
      'invest|investing|investment|investor|investors|stock|stocks|market|markets',
      'simulation|simulated|simulate|simulator',
      'consciousness|conscious|aware|awareness|sentient',
      'abundance|abundant|scarcity|scarce|post scarcity',
      'fly|flying|flight|aircraft|airplane|plane|planes',
      'religion|god|faith|spiritual|church',
      'family|wife|husband|parents|mother|father|mom|dad',
    ];

    function norm(w) {
      return String(w).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'")
        .replace(/[^\p{L}\p{N}']+/gu, '').replace(/^'+|'+$/g, '').replace(/'s$/, '');
    }
    /** A word → its normalized parts ("self-driving" → self, driving). */
    function parts(w) { return String(w).split(/[-–—\/]+/).map(norm).filter(Boolean); }

    var isV = function (c) { return 'aeiou'.indexOf(c) >= 0; };
    /** A light English stemmer (the same on both sides, so over-stemming only merges near words). */
    function stem(w) {
      if (w.length <= 3 || /\d/.test(w)) return w;
      var s = w;
      // plurals
      if (/sses$/.test(s)) s = s.slice(0, -2);
      else if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y';
      else if (/(ss|us|is)$/.test(s)) { /* keep */ }
      else if (/(ches|shes|xes|zes)$/.test(s)) s = s.slice(0, -2);
      else if (/s$/.test(s) && s.length > 3) s = s.slice(0, -1);
      // one derivational / inflectional suffix
      var rules = [['ational', 'ate'], ['ization', 'ize'], ['isation', 'ize'], ['fulness', 'ful'], ['iveness', 'ive'], ['ousness', 'ous'],
        ['ation', 'ate'], ['ments', ''], ['ment', ''], ['ness', ''], ['ity', ''], ['ingly', ''], ['edly', ''], ['ing', ''], ['ed', ''], ['ly', '']];
      for (var k = 0; k < rules.length; k++) {
        var suf = rules[k][0];
        if (s.length - suf.length >= 3 && s.slice(-suf.length) === suf) {
          var base = s.slice(0, -suf.length);
          if ((suf === 'ing' || suf === 'ed' || suf === 'ingly' || suf === 'edly') && !/[aeiouy]/.test(base)) break;   // "sing", "red"
          if (suf === 'ed' && /eed$/.test(s)) break;   // "speed", "need"
          s = base + rules[k][1];
          // running → run, stopped → stop (not "ll", "ss", "zz")
          if ((suf === 'ing' || suf === 'ed') && s.length >= 3 && s[s.length - 1] === s[s.length - 2] && !isV(s[s.length - 1]) && !/[lsz]/.test(s[s.length - 1])) s = s.slice(0, -1);
          // making → mak → make, caring → car → care (a 3-letter consonant-vowel-consonant base had an "e")
          else if ((suf === 'ing' || suf === 'ed') && s.length === 3 && !isV(s[0]) && isV(s[1]) && !isV(s[2]) && !/[wxy]/.test(s[2])) s += 'e';
          break;
        }
      }
      if (s.length > 4 && /e$/.test(s)) s = s.slice(0, -1);   // simulate / simulated → simulat (not "care" → "car")
      if (/y$/.test(s) && s.length > 3) s = s.slice(0, -1) + 'i';   // company / companies → compani
      return s;
    }

    function termsOf(text) {   // a synonym member / phrase → its content stems
      var out = [];
      String(text).split(/\s+/).forEach(function (w) { parts(w).forEach(function (n) { if (!STOP[n]) out.push(stem(n)); }); });
      return out;
    }
    var GROUPS = SYN.map(function (g) { return g.split('|').map(termsOf).filter(function (x) { return x.length; }); });
    var key = function (stems) { return stems.join(' '); };

    function buildIndex(paras) {
      var docs = paras.map(function (ws, p) {
        var seq = [];
        ws.forEach(function (w, i) { parts(w).forEach(function (n) { if (!STOP[n]) seq.push({ s: stem(n), i: i }); }); });
        var tf = Object.create(null);
        seq.forEach(function (t, k) { (tf[t.s] || (tf[t.s] = [])).push(k); });
        return { p: p, seq: seq, tf: tf, len: seq.length, n: ws.length };
      });
      var df = Object.create(null), total = 0;
      docs.forEach(function (d) { total += d.len; Object.keys(d.tf).forEach(function (s) { df[s] = (df[s] || 0) + 1; }); });
      return { paras: paras, docs: docs, df: df, vocab: Object.keys(df), avg: Math.max(1, total / Math.max(1, docs.length)), phraseDf: Object.create(null) };
    }

    /** The question → terms: "quoted phrases", synonym phrases ("basic income"), then single words; filler dropped. */
    function parseQuery(q) {
      var phrases = [];
      var rest = String(q).replace(/["“”]([^"“”]+)["“”]/g, function (m, x) { phrases.push(x); return ' '; });
      var toks = [];
      rest.split(/\s+/).forEach(function (w) { parts(w).forEach(function (n) { if (!STOP[n] && !QUERY_STOP[n]) toks.push({ s: stem(n), raw: n }); }); });
      var terms = [], seen = {};
      function add(stems, label, kind) { var k = key(stems); if (!stems.length || seen[k]) return; seen[k] = true; terms.push({ stems: stems, label: label, kind: kind }); }
      phrases.forEach(function (x) { add(termsOf(x), x, 'phrase'); });
      // multi-word synonym members written in the question become one phrase term
      var used = toks.map(function () { return false; });
      GROUPS.forEach(function (g) {
        g.forEach(function (m) {
          if (m.length < 2) return;
          for (var i = 0; i + m.length <= toks.length; i++) {
            var ok = true;
            for (var j = 0; j < m.length; j++) if (used[i + j] || toks[i + j].s !== m[j]) { ok = false; break; }
            if (ok) { for (j = 0; j < m.length; j++) used[i + j] = true; add(m, toks.slice(i, i + m.length).map(function (t) { return t.raw; }).join(' '), 'phrase'); }
          }
        });
      });
      toks.forEach(function (t, i) { if (!used[i]) add([t.s], t.raw, 'word'); });
      return terms;
    }

    function lev(a, b, max) {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      var prev = [], cur = [], i, j;
      for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        cur = [i]; var best = i;
        for (j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          if (cur[j] < best) best = cur[j];
        }
        if (best > max) return max + 1;
        prev = cur;
      }
      return prev[b.length];
    }

    /** A term → the variants searched for it: itself (1), its synonyms (.6), longer forms (.7), near spellings (.6). */
    function expand(index, term) {
      var vars = [], at = {};
      function add(stems, w, kind) { var k = key(stems); if (at[k] !== undefined) { if (vars[at[k]].w < w) { vars[at[k]].w = w; vars[at[k]].kind = kind; } return; } at[k] = vars.length; vars.push({ stems: stems, w: w, kind: kind }); }
      add(term.stems, 1, 'exact');
      var k0 = key(term.stems);
      GROUPS.forEach(function (g) {
        if (!g.some(function (m) { return key(m) === k0; })) return;
        g.forEach(function (m) { add(m, 0.6, 'synonym'); });
      });
      if (term.stems.length === 1 && !/\d/.test(term.stems[0])) {
        var s = term.stems[0], max = s.length >= 10 ? 2 : 1, typo = !index.df[s];
        index.vocab.forEach(function (v) {
          if (v === s) return;
          if (s.length >= 4 && v.indexOf(s) === 0 && v.length - s.length <= 4) add([v], 0.7, 'prefix');   // robot → robotic
          else if (v.length >= 4 && s.indexOf(v) === 0 && s.length - v.length <= 3) add([v], 0.7, 'prefix');   // worker → work
          else if (typo && s.length >= 5 && v[0] === s[0] && lev(s, v, max) <= max) add([v], 0.8, 'fuzzy');   // a typo: only when the word itself is not in the video
        });
      }
      return vars;
    }

    /** Where a variant occurs in a doc: indexes into doc.seq of its first stem. */
    function hitsOf(d, v) {
      var first = d.tf[v.stems[0]];
      if (!first) return [];
      if (v.stems.length === 1) return first;
      return first.filter(function (k) {
        for (var j = 1; j < v.stems.length; j++) if (!d.seq[k + j] || d.seq[k + j].s !== v.stems[j]) return false;
        return true;
      });
    }
    function dfOf(index, v) {
      if (v.stems.length === 1) return index.df[v.stems[0]] || 0;
      var k = key(v.stems);
      if (index.phraseDf[k] === undefined) index.phraseDf[k] = index.docs.filter(function (d) { return hitsOf(d, v).length > 0; }).length;
      return index.phraseDf[k];
    }

    /** The smallest number of words that holds one hit of every list. */
    function minWindow(lists) {
      var all = [];
      lists.forEach(function (l, i) { l.forEach(function (p) { all.push([p, i]); }); });
      all.sort(function (a, b) { return a[0] - b[0]; });
      var need = lists.length, have = 0, cnt = {}, best = Infinity, lo = 0;
      for (var hi = 0; hi < all.length; hi++) {
        if (!cnt[all[hi][1]]) have++;
        cnt[all[hi][1]] = (cnt[all[hi][1]] || 0) + 1;
        while (have === need) {
          best = Math.min(best, all[hi][0] - all[lo][0] + 1);
          if (--cnt[all[lo][1]] === 0) have--;
          lo++;
        }
      }
      return best;
    }

    var ENDS = /[.?!…]["'”’)\]]*$/;
    /** The words of a paragraph to show: all of a short one, else ~40 words around the most hits, out to sentence ends. */
    function windowOf(words, hits) {
      var n = words.length;
      if (n <= 70 || !hits.length) return [0, Math.min(n - 1, hits.length ? n - 1 : 59)];
      var W = 40, bestS = 0, bestC = -1;
      hits.forEach(function (h) {
        var s = Math.max(0, Math.min(h - 8, n - W)), c = hits.filter(function (x) { return x >= s && x < s + W; }).length;
        if (c > bestC) { bestC = c; bestS = s; }
      });
      var inWin = hits.filter(function (x) { return x >= bestS && x < bestS + W; });
      var a = Math.max(0, inWin[0] - 10), b = Math.min(n - 1, inWin[inWin.length - 1] + 16);
      for (var k = 0; k < 15 && a > 0 && !ENDS.test(words[a - 1]); k++) a--;
      for (k = 0; k < 20 && b < n - 1 && !ENDS.test(words[b]); k++) b++;
      if (b - a > 85) b = a + 85;
      return [a, b];
    }

    /** Ranked passages for a question. opts: { limit = 8 }. */
    function search(index, q, opts) {
      opts = opts || {};
      var limit = opts.limit || 8, k1 = 1.2, b = 0.75, N = index.docs.length;
      var terms = parseQuery(q).map(function (t) { return { term: t, vars: expand(index, t) }; });
      if (!terms.length) return { terms: [], results: [], matched: 0 };
      terms.forEach(function (T) { T.vars.forEach(function (v) { var df = dfOf(index, v); v.df = df; v.idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)); }); });
      var scored = [];
      index.docs.forEach(function (d) {
        var sum = 0, matched = 0, lists = [], hitWords = {};
        terms.forEach(function (T, ti) {
          var best = 0, pos = [];
          T.vars.forEach(function (v) {
            var h = v.df ? hitsOf(d, v) : [];
            if (!h.length) return;
            var tf = h.length, sc = v.w * v.idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * d.len / index.avg));
            if (sc > best) best = sc;
            h.forEach(function (k) { pos.push(d.seq[k].i); for (var j = 0; j < v.stems.length; j++) hitWords[d.seq[k + j].i] = true; });
          });
          if (best > 0) { sum += best; matched++; lists.push(pos); }
        });
        if (!matched) return;
        var cov = matched / terms.length, score = sum * (0.35 + 0.65 * cov * cov);
        if (matched >= 2) score *= 1 + 0.6 * cov * Math.max(0, 1 - (minWindow(lists) - matched) / 40);
        scored.push({ para: d.p, score: score, matched: matched, hits: Object.keys(hitWords).map(Number).sort(function (x, y) { return x - y; }) });
      });
      scored.sort(function (x, y) { return y.score - x.score || x.para - y.para; });
      var picked = [];
      for (var i = 0; i < scored.length && picked.length < limit; i++) {
        var r = scored[i], near = null;
        for (var j = 0; j < picked.length; j++) if (Math.abs(picked[j].para - r.para) <= 1) { near = picked[j]; break; }
        if (near) { near.near++; continue; }   // the same stretch of talk: keep the better paragraph only
        var win = windowOf(index.paras[r.para], r.hits);
        picked.push({ para: r.para, score: r.score, matched: r.matched, total: terms.length, hits: r.hits, w0: win[0], w1: win[1], near: 0 });
      }
      return { terms: terms, results: picked, matched: scored.length };
    }

    /** Does a transcript word match one of the search's single-word variants? (marking words in AI passages) */
    function wordMatches(terms, word) {
      var ss = parts(word).filter(function (n) { return !STOP[n]; }).map(stem);
      return terms.some(function (T) { return T.vars.some(function (v) { return v.stems.length === 1 && ss.indexOf(v.stems[0]) >= 0; }); });
    }

    return { norm: norm, stem: stem, parseQuery: parseQuery, expand: expand, buildIndex: buildIndex, search: search, wordMatches: wordMatches, windowOf: windowOf, lev: lev };
  })();
  if (typeof window === 'undefined' || !window.LABS) { if (typeof globalThis !== 'undefined') globalThis.__askTheVideoEngine = engine; return; }

  // ======================= the panel =======================
  var L = window.LABS, el = L.ui.el, fmt = L.ui.fmt, ID = 'ask-the-video', T = L.transcript;
  L.ui.css(ID, [
    '.ak-head { position: sticky; top: -4px; z-index: 2; background: var(--panel); padding: 6px 6px 7px; border-bottom: 1px solid var(--line); }',
    '.ak-row { display: flex; gap: 6px; }',
    '.ak-head input { flex: 1; min-width: 0; font: 13.5px system-ui, sans-serif; padding: 5px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--ink); }',
    '.ak-head input:focus { outline: none; border-color: var(--accent); }',
    '.ak-head button { flex: none; font: 12.5px system-ui, sans-serif; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 2px 10px; cursor: pointer; }',
    '.ak-head button:hover { border-color: var(--accent); }',
    '.ak-engine { margin-top: 6px; font-size: 12px; color: var(--muted); line-height: 1.45; }',
    '.ak-engine b { color: var(--ink); font-weight: 600; }',
    '.ak-engine .warn { color: var(--accent); }',
    '.ak-engine a { color: var(--accent); cursor: pointer; text-decoration: underline; }',
    '.ak-engine code { font: 11.5px ui-monospace, monospace; }',
    '.ak-terms { margin-top: 3px; font-size: 11.5px; color: var(--muted); }',
    '.ak-strip { position: relative; height: 10px; margin-top: 6px; border-radius: 3px; background: var(--hl); cursor: pointer; }',
    '.ak-strip span { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1px; border-radius: 1px; background: var(--muted); }',
    '.ak-strip span.ai { background: var(--accent); }',
    '.ak-sec { padding: 8px 8px 3px; font: 600 12px system-ui, sans-serif; color: var(--ink); }',
    '.ak-sec .n { font-weight: 400; color: var(--muted); }',
    '.ak-item { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); border-radius: 6px; cursor: pointer; }',
    '.ak-item:hover { background: var(--hl); }',
    '.ak-rank { font: 600 11.5px ui-monospace, monospace; color: var(--muted); padding-top: 1px; }',
    '.ak-t { font: 12px ui-monospace, monospace; color: var(--accent); margin-right: 6px; }',
    '.ak-meta { font-size: 11px; color: var(--muted); }',
    '.ak-q { display: block; margin-top: 2px; line-height: 1.45; color: var(--ink); }',
    '.ak-q mark { background: var(--hl-word); color: var(--hl-ink); border-radius: 2px; }',
    '.ak-empty { padding: 12px 10px; color: var(--muted); font-size: 13px; line-height: 1.5; }',
    '.ak-spin { display: inline-block; animation: ak-spin 1s linear infinite; }',
    '@keyframes ak-spin { to { transform: rotate(360deg); } }',
  ].join('\n'));

  var index = engine.buildIndex(T.paragraphs.map(function (p) { return p.words; }));
  var S = { q: '', local: null, ai: null, aiStatus: null, seq: 0 };
  var refs = {}, hover = null, timer = null;
  var gutter = T.addGutterLayer(ID);
  var dur = L.video.duration() || (T.paragraphs.length ? T.paragraphs[T.paragraphs.length - 1].times.slice(-1)[0] : 1) || 1;

  fetch('/labs/x/' + ID + '/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) { S.aiStatus = s; showEngine(); }).catch(function () { S.aiStatus = { available: false, reason: 'the AI route did not answer' }; });

  var wordText = function (p, w) { return T.text({ startPara: p, startWord: w, endPara: p, endWord: w }); };
  var spanStart = function (s) { return T.paragraphs[s.startPara].times[s.startWord]; };

  // a passage: the transcript's words, the matching ones marked
  function passage(span, isHit, cutBefore, cutAfter) {
    var q = el('span', { class: 'ak-q' });
    if (cutBefore) q.append('… ');
    var first = true;
    T.eachWord(span, function (p, w) {
      if (!first) q.append(' ');
      first = false;
      var t = wordText(p, w);
      q.append(isHit(p, w, t) ? el('mark', {}, [t]) : t);
    });
    if (cutAfter) q.append(' …');
    return q;
  }
  function item(rank, span, top, q, cls) {
    var it = el('div', { class: 'ak-item' + (cls ? ' ' + cls : '') }, [el('span', { class: 'ak-rank' }, [String(rank)]), el('div', {}, top.concat([q]))]);
    it.onclick = function () { L.video.seek(spanStart(span)); };
    it.onmouseenter = function () { if (hover) hover.remove(); hover = T.highlightRange(span); };
    it.onmouseleave = function () { if (hover) { hover.remove(); hover = null; } };
    return it;
  }

  function runLocal(q) {
    S.q = q;
    S.local = q.trim() ? engine.search(index, q, { limit: 8 }) : null;
    if (S.ai && S.ai.q !== q.trim()) S.ai = null;   // a new question: the AI answer was for the old one
    showResults();
  }

  function askAI(q, retry) {
    q = q.trim();
    if (q.length < 2) return;
    var seq = ++S.seq;
    S.ai = { q: q, state: 'running', startedAt: Date.now() };
    showResults();
    clearInterval(timer); timer = setInterval(showEngine, 1000);
    fetch('/labs/x/' + ID + '/ask', { method: 'POST', body: JSON.stringify({ q: q, retry: !!retry }) })
      .then(function (r) { return r.json(); })
      .catch(function (e) { return { ok: false, error: String(e) }; })
      .then(function (res) {
        if (seq !== S.seq) return;
        clearInterval(timer);
        if (S.q.trim() !== q) return;   // typed something else meanwhile (the answer is cached for next time)
        S.ai = { q: q, state: res.ok ? 'done' : 'failed', res: res, startedAt: S.ai.startedAt };
        if (res.ok) S.aiStatus = { available: true, reason: null };
        else if (res.loginNeeded) S.aiStatus = { available: false, reason: res.error, login: true };
        L.log('ask-the-video: AI ' + (res.ok ? (res.passages || []).length + ' passages' + (res.cached ? ' (cached)' : '') : 'failed: ' + res.error));
        showResults();
      });
  }

  function loginish(msg) { return /log ?in|logged out|auth|oauth|credential|expired/i.test(msg || ''); }

  function showEngine() {
    var box = refs.engine; if (!box || !box.isConnected) return;
    box.textContent = '';
    var loc = S.local, ai = S.ai;
    if (!S.q.trim()) {
      box.append('Type a topic — keyword matches show as you type. ');
      box.append(S.aiStatus && !S.aiStatus.available
        ? el('span', { class: 'warn' }, [loginish(S.aiStatus.reason) ? 'AI search needs `claude` login (keyword search works).' : 'AI search unavailable: ' + S.aiStatus.reason])
        : 'Press Enter to ask Claude too.');
      return;
    }
    var locText = loc ? (loc.results.length ? loc.matched + ' paragraph' + (loc.matched === 1 ? '' : 's') + ' match' + (loc.matched === 1 ? 'es' : '') + ', top ' + loc.results.length + ' shown' : 'no keyword matches') : '';
    if (!ai) {
      box.append(el('b', {}, ['⚡ Keyword search (local)']), ' — ' + locText + '. ');
      if (S.aiStatus && !S.aiStatus.available) box.append(el('span', { class: 'warn' }, [loginish(S.aiStatus.reason) ? 'AI search needs `claude` login.' : 'AI search unavailable.']));
      else box.append('Enter = ask Claude too.');
    } else if (ai.state === 'running') {
      box.append(el('span', { class: 'ak-spin' }, ['◐']), ' ', el('b', {}, ['🤖 Asking Claude…']), ' ' + Math.round((Date.now() - ai.startedAt) / 1000) + ' s — showing ⚡ keyword matches meanwhile (' + locText + ').');
    } else if (ai.state === 'done') {
      var r = ai.res;
      box.append(el('b', {}, ['🤖 Answered by AI']), ' (claude' + (r.models && r.models.length ? ' · ' + r.models.join('+') : '') + ' · ' + r.passages.length + ' passage' + (r.passages.length === 1 ? '' : 's') +
        (r.cached ? ' · cached' : ' · ' + Math.round((r.ms || 0) / 1000) + ' s') + '), then ⚡ keyword matches (' + locText + ').');
    } else {
      var res = ai.res || {};
      if (res.loginNeeded && loginish(res.error)) box.append(el('span', { class: 'warn' }, ['AI search needs ', el('code', {}, ['claude']), ' login — showing keyword matches']), ' (⚡ ' + locText + '). Run ', el('code', {}, ['claude']), ' in a terminal and /login, then ');
      else box.append(el('span', { class: 'warn' }, ['AI search failed — showing keyword matches']), ' (⚡ ' + locText + '). ', el('span', { title: res.error || '' }, [(res.error || '').slice(0, 140)]), ' ');
      var again = el('a', { title: 'Ask Claude again now' }, ['try again']);
      again.onclick = function () { askAI(S.q, true); };
      box.append(again, '.');
    }
  }

  function showResults() {
    showEngine();
    var list = refs.list, strip = refs.strip, termsEl = refs.terms;
    gutter.clear();
    if (!list || !list.isConnected) return;
    list.textContent = ''; strip.textContent = ''; termsEl.textContent = '';
    var loc = S.local, ai = S.ai && S.ai.state === 'done' ? S.ai.res : null;
    if (!S.q.trim()) {
      list.appendChild(el('div', { class: 'ak-empty' }, ['Ask where something is talked about, e.g. ', el('i', {}, ['universal income']), ', ', el('i', {}, ['why robots get cheaper']), ', ', el('i', {}, ['"exact phrase"']), '. ',
        'Every passage is the transcript’s own words; click one to play from there.']));
      strip.style.display = 'none';
      return;
    }
    strip.style.display = '';
    if (loc && loc.terms.length) {
      termsEl.append('Searching for: ' + loc.terms.map(function (t) {
        var extra = t.vars.filter(function (v) { return v.kind !== 'exact'; }).length;
        return t.term.label + (extra ? ' (+' + extra + ' related)' : '');
      }).join(' · '));
      termsEl.title = loc.terms.map(function (t) { return t.term.label + ': ' + t.vars.map(function (v) { return v.stems.join(' ') + (v.kind === 'exact' ? '' : ' (' + v.kind + ')'); }).join(', '); }).join('\n');
    }
    var tick = function (t, cls, title) { var s = el('span', { class: cls || '', title: title, style: { left: Math.max(0, Math.min(100, t / dur * 100)) + '%' } }); strip.appendChild(s); };
    var hitOf = function (p, w, t) { return loc ? engine.wordMatches(loc.terms, t) : false; };
    if (ai) {
      list.appendChild(el('div', { class: 'ak-sec' }, ['🤖 AI found ', el('span', { class: 'n' }, [ai.passages.length ? '· verbatim passages, best first' : '· nothing in this video'])]));
      ai.passages.forEach(function (s, i) {
        list.appendChild(item(i + 1, s, [el('span', { class: 'ak-t' }, [fmt(s.t0) + '–' + fmt(s.t1)]), el('span', { class: 'ak-meta' }, ['AI · ' + '●●●●●'.slice(0, s.score) + '○○○○○'.slice(0, 5 - s.score)])], passage(s, hitOf), 'ai'));
        tick(s.t0, 'ai', 'AI #' + (i + 1) + ' · ' + fmt(s.t0));
        gutter.set(s.startPara, '🔎', { title: 'Ask: AI result ' + (i + 1), onClick: function () { L.video.seek(s.t0); } });
      });
    }
    if (loc) {
      if (ai) list.appendChild(el('div', { class: 'ak-sec' }, ['⚡ Keyword matches ', el('span', { class: 'n' }, ['· local'])]));
      if (!loc.results.length) list.appendChild(el('div', { class: 'ak-empty' }, [loc.terms.length ? 'No paragraph has these words (or their related forms). Try other words' + (ai ? '.' : ', or press Enter to ask Claude.') : 'Only filler words — type a topic.']));
      loc.results.forEach(function (r, i) {
        var P = T.paragraphs[r.para], span = { startPara: r.para, startWord: r.w0, endPara: r.para, endWord: r.w1 }, hits = {};
        r.hits.forEach(function (h) { hits[h] = true; });
        var meta = r.matched + '/' + r.total + ' query words' + (r.near ? ' · continues nearby' : '');
        list.appendChild(item(i + 1, span, [el('span', { class: 'ak-t' }, [fmt(P.times[r.w0])]), el('span', { class: 'ak-meta' }, [meta])],
          passage(span, function (p, w) { return !!hits[w]; }, r.w0 > 0, r.w1 < P.words.length - 1)));
        tick(P.times[r.w0], '', '#' + (i + 1) + ' · ' + fmt(P.times[r.w0]));
        if (!ai) gutter.set(r.para, '🔎', { title: 'Ask: keyword result ' + (i + 1), onClick: function () { L.video.seek(P.times[r.w0]); } });
      });
    }
  }

  function render(box) {
    var input = el('input', { type: 'search', placeholder: 'Where do they talk about…?', value: S.q, spellcheck: 'false' });
    var askBtn = el('button', { title: 'Ask Claude (extractive: it can only point at passages). Keyword matches show anyway.' }, ['Ask AI']);
    refs.engine = el('div', { class: 'ak-engine' });
    refs.terms = el('div', { class: 'ak-terms' });
    refs.strip = el('div', { class: 'ak-strip', title: 'Where the results are in the video (orange = AI). Click to jump.' });
    refs.list = el('div');
    refs.input = input;
    refs.strip.onclick = function (e) { var r = refs.strip.getBoundingClientRect(); L.video.seek((e.clientX - r.left) / r.width * dur); };
    var deb = null;
    input.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(function () { runLocal(input.value); }, 120); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(deb); runLocal(input.value); askAI(input.value); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = ''; runLocal(''); input.blur(); }
    });
    askBtn.onclick = function () { runLocal(input.value); askAI(input.value); };
    box.append(el('div', { class: 'ak-head' }, [el('div', { class: 'ak-row' }, [input, askBtn]), refs.engine, refs.terms, refs.strip]), refs.list);
    showResults();
  }

  var tabApi = T.addPanelTab(ID, '🔎 Ask', render);
  L.ui.addKey('/', function () { tabApi.show(); setTimeout(function () { if (refs.input) { refs.input.focus(); refs.input.select(); } }, 30); }, 'Ask the video (search)');
})();
