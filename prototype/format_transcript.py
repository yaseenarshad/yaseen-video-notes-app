import re, sys, difflib
vtt_path, md_path, out_path, url = sys.argv[1:5]
tsec = lambda h,m,s,ms: int(h)*3600+int(m)*60+int(s)+int(ms)/1000

# 1. word-level times from the vtt (lines with <c> tags)
vw = []
for m in re.finditer(r'(\d\d):(\d\d):(\d\d)\.(\d+) --> [^\n]*\n(.*?)(?:\n\n|\Z)', open(vtt_path).read(), re.S):
    start = tsec(*m.groups()[:4])
    for ln in m.group(5).split('\n'):
        if '<c>' in ln or re.search(r'<\d\d:', ln):
            t = start
            for piece in re.split(r'(<\d\d:\d\d:\d\d\.\d+>)', ln):
                mm = re.match(r'<(\d\d):(\d\d):(\d\d)\.(\d+)>', piece)
                if mm: t = tsec(*mm.groups()); continue
                for w in re.sub(r'<[^>]+>', '', piece).split():
                    vw.append((w, t))
            break

# 2. md words, with turn markers
md = open(md_path).read()
cut = md.index('\n---\n', md.index('\n# '))
head, body = md[:cut], md[cut+5:]
mw = []  # [word, new_turn]
new = False
for tok in body.split():
    if tok == '>>': new = True; continue
    mw.append([tok, new]); new = False

norm = lambda w: re.sub(r'[^a-z0-9]', '', w.lower())
a = [norm(w) for w, _ in mw]; b = [norm(w) for w, t in vw if w != '>>']
bt = [t for w, t in vw if w != '>>']
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
times = [None]*len(a)
for i, j, n in sm.get_matching_blocks():
    for k in range(n): times[i+k] = bt[j+k]
matched = sum(t is not None for t in times)
last = 0
for i in range(len(times)):
    if times[i] is None: times[i] = last
    last = times[i]
print(f'md words {len(a)}, caption words {len(b)}, matched {matched}', file=sys.stderr)

# 3. paragraphs: new speaker turn, or ~110 words then break at sentence end
def ts(sec):
    sec = int(sec); h, r = divmod(sec, 3600); m, s = divmod(r, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'
paras = []
for (w, turn), t in zip(mw, times):
    if not paras or turn or paras[-1]['split']:
        paras.append({'t': t, 'w': [], 'turn': turn, 'split': False})
    p = paras[-1]; p['w'].append(w)
    if len(p['w']) >= 110 and re.search(r'[.?!]["\')]?$', w): p['split'] = True

base = url.split('&')[0]
out = [head + '\n---\n']
for i, p in enumerate(paras):
    dash = '— ' if p['turn'] else ''
    out.append(f"[{ts(p['t'])}]({base}&t={int(p['t'])}s) {dash}{' '.join(p['w'])}\n")
open(out_path, 'w').write('\n'.join(out))
print('paragraphs', len(paras), file=sys.stderr)

import json
data = {'title': head.split('\n# ',1)[1].split('\n')[0], 'id': re.search(r'v=([\w-]+)', url).group(1),
        'paras': [{'turn': p['turn'], 'w': p['w']} for p in paras], 't': []}
i = 0
for p in paras:
    data['t'].append([round(x, 2) for x in times[i:i+len(p['w'])]]); i += len(p['w'])
json.dump(data, open(out_path.replace('.md', '.json'), 'w'), separators=(',', ':'))
