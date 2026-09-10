#!/usr/bin/env python3
"""Recover an off-host backup to an isolated directory and verify both databases.

This never overwrites the running database. Runtime replay is a separate explicit check.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('snapshot', help='An existing UTC snapshot directory in the backups container')
args = parser.parse_args()
if not re.fullmatch(r'[0-9]{8}T[0-9]{6}\.[0-9]{6}Z', args.snapshot):
    raise SystemExit('An exact backup snapshot ID is required')
base = Path('/srv/facio-kernel')
destination = base / 'recovery' / args.snapshot
destination.mkdir(mode=0o700, parents=True, exist_ok=False)
def fetch(name):
    target = destination / name
    subprocess.run(['python3', str(base / 'deploy' / 'blob.py'), 'download', 'backups', args.snapshot + '/' + name, str(target)], check=True)
    os.chmod(target, 0o600)
    return target
manifest = json.loads(fetch('manifest.json').read_text())
if {item['file'] for item in manifest['databases']} != {'kernel.sqlite', 'auth.sqlite'}:
    raise SystemExit('A complete two-database backup is required for restore rehearsal')
result = {'snapshot': args.snapshot, 'liveDataOverwritten': False, 'databases': []}
for item in manifest['databases']:
    restored = fetch(item['file'])
    if hashlib.sha256(restored.read_bytes()).hexdigest() != item['sha256']:
        raise SystemExit('Backup checksum mismatch')
    with sqlite3.connect(restored.as_uri() + '?mode=ro', uri=True) as database:
        if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Restored SQLite integrity failed')
        tables = database.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
    result['databases'].append({'file': item['file'], 'sha256': item['sha256'], 'integrity': 'ok', 'tableCount': tables})
report = destination / 'restore-evidence.json'
report.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
