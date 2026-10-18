#!/usr/bin/env python3
"""Build player.html from player-template.html + transcript JSON.
USAGE: python3 build_player.py <transcript.json> <media path> [out.html]"""
import json, sys
data, media = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else 'player.html'
t = open('player-template.html', encoding='utf-8').read()
d = open(data, encoding='utf-8').read().replace('</', '<\\/')
open(out, 'w', encoding='utf-8').write(t.replace('/*DATA*/', d).replace('/*MEDIA*/', json.dumps(media)))
print('wrote', out)
