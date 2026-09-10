#!/usr/bin/env python3
"""Switch only the Platform Caddy upstream after verifying the staged build."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--commit', required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{40}', args.commit): raise SystemExit('Expected a full source commit')
with urllib.request.urlopen('http://127.0.0.1:4320/health', timeout=10) as response:
    health = json.load(response)
if health.get('build') != args.commit or health.get('deployment') != 'shared-mga-platform' or health.get('status') != 'ok':
    raise SystemExit('Staged application health/build mismatch; public upstream unchanged')
config = Path('/etc/caddy/Caddyfile')
original = config.read_text()
old, new = 'reverse_proxy 127.0.0.1:4310', 'reverse_proxy 127.0.0.1:4320'
if new in original:
    if original.count(new) != 1: raise SystemExit('Unexpected Caddy topology')
else:
    if original.count(old) != 1: raise SystemExit('Expected existing Platform upstream exactly once')
    candidate = original.replace(old, new)
    backup = Path('/srv/facio-platform/deploy') / f'Caddyfile.before-{args.commit}'
    if not backup.exists(): shutil.copy2(config, backup)
    temporary = Path('/etc/caddy/Caddyfile.platform-next')
    temporary.write_text(candidate)
    subprocess.run(['caddy', 'validate', '--config', str(temporary), '--adapter', 'caddyfile'], check=True)
    temporary.replace(config)
    try:
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        with urllib.request.urlopen('https://platform.facio.io/health', timeout=20) as response:
            public = json.load(response)
        if public.get('build') != args.commit: raise RuntimeError('Public build does not match staged release')
    except Exception:
        config.write_text(original)
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        raise
print(json.dumps({'publicUrl': 'https://platform.facio.io', 'build': args.commit, 'upstreamPort': 4320, 'previousContainerPreserved': True}))
