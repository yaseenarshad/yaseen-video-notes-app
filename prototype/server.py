#!/usr/bin/env python3
"""Follow-along player helper.

Serves the player page + local video (with seeking), and reads/writes notes
inside the transcript markdown file.

USAGE:
    python3 server.py --md flying-tesla-formatted.md [--port 8765]

Notes live right under the paragraph they belong to:
    [29:27](https://youtube.com/watch?v=ID&t=1767s) — paragraph text...

    > 💬 [29:41](https://youtube.com/watch?v=ID&t=1781s) my note

Notes typed by hand in Obsidian work too: any line starting with "> 💬"
belongs to the paragraph above it (the time link is optional).
"""
import argparse, json, os, re, tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PARA = re.compile(r'^\[(\d+(?::\d\d)+)\]\(([^)]*?)&t=(\d+)s\)')
NOTE = re.compile(r'^>\s*💬\s?(.*)$')
NOTE_TIME = re.compile(r'^\[(\d+(?::\d\d)+)\]\([^)]*?&t=(\d+)s\)\s*(.*)$')


def fmt(sec):
    sec = int(sec); h, r = divmod(sec, 3600); m, s = divmod(r, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def read_notes(path):
    """Return [{para, time, text}] where para = index of the timestamp paragraph."""
    notes, para, cur = [], -1, None
    for line in open(path, encoding='utf-8').read().split('\n'):
        if PARA.match(line):
            para += 1; cur = None; continue
        m = NOTE.match(line)
        if m and para >= 0:
            body, t = m.group(1), None
            mt = NOTE_TIME.match(body)
            if mt: t, body = int(mt.group(2)), mt.group(3)
            cur = {'para': para, 'time': t, 'text': body}; notes.append(cur); continue
        if cur and line.startswith('>'):          # multi-line note continuation
            cur['text'] += '\n' + line[1:].lstrip(); continue
        cur = None
    return notes


def add_note(path, para_idx, time, text):
    lines = open(path, encoding='utf-8').read().split('\n')
    para, insert_at, base = -1, None, None
    for i, line in enumerate(lines):
        m = PARA.match(line)
        if m:
            if para == para_idx: break            # reached the next paragraph
            para += 1
            if para == para_idx: base = m.group(2); insert_at = i + 1
        elif para == para_idx and line.strip():
            insert_at = i + 1                     # after paragraph text + existing notes
    if insert_at is None:
        raise ValueError(f'paragraph {para_idx} not found')
    body = text.strip().split('\n')
    block = [f'> 💬 [{fmt(time)}]({base}&t={int(time)}s) {body[0]}'] + [f'> {l}' for l in body[1:]]
    lines[insert_at:insert_at] = [''] + block
    # atomic write so Obsidian never sees a half-written file
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), suffix='.tmp')
    with os.fdopen(fd, 'w', encoding='utf-8') as f: f.write('\n'.join(lines))
    os.replace(tmp, path)


class Handler(SimpleHTTPRequestHandler):
    md = None

    def log_message(self, *a): pass

    def send_json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith('/api/notes'):
            return self.send_json(read_notes(self.md))
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if rng and os.path.isfile(path):              # byte ranges so the video can seek
            size = os.path.getsize(path)
            m = re.match(r'bytes=(\d*)-(\d*)', rng)
            start = int(m.group(1) or 0); end = min(int(m.group(2) or size - 1), size - 1)
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1)); self.end_headers()
            with open(path, 'rb') as f:
                f.seek(start); left = end - start + 1
                try:
                    while left > 0:
                        chunk = f.read(min(1 << 16, left))
                        if not chunk: break
                        self.wfile.write(chunk); left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError): pass
            return
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/notes': return self.send_json({'error': 'not found'}, 404)
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or '{}')
        try:
            add_note(self.md, int(body['para']), float(body['time']), str(body['text']))
        except Exception as e:
            return self.send_json({'error': str(e)}, 400)
        return self.send_json(read_notes(self.md))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--md', required=True, help='transcript markdown file to read/write notes in')
    ap.add_argument('--port', type=int, default=8765)
    a = ap.parse_args()
    Handler.md = os.path.abspath(a.md)
    print(f'Player: http://localhost:{a.port}/player.html  (notes -> {Handler.md})')
    ThreadingHTTPServer(('127.0.0.1', a.port), Handler).serve_forever()
