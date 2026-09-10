#!/usr/bin/env python3
"""Online consistent SQLite snapshots; the live DB files are never copied directly."""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess

base = Path('/srv/facio-kernel')
os.umask(0o077)
backup_lock = (base / 'backup.lock').open('a')
fcntl.flock(backup_lock, fcntl.LOCK_EX)
destination = base / 'backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
destination.mkdir(mode=0o700, parents=True)
manifest = {'createdAt': datetime.now(timezone.utc).isoformat(), 'databases': []}
for name in ('kernel.sqlite', 'auth.sqlite'):
    source = base / 'data' / name
    if not source.exists():
        continue
    snapshot = destination / name
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(snapshot) as backup:
            original.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise SystemExit('Backup integrity check failed')
    os.chmod(snapshot, 0o600)
    manifest['databases'].append({'file': name, 'sha256': hashlib.sha256(snapshot.read_bytes()).hexdigest()})
if not manifest['databases']:
    raise SystemExit('No initialized databases; no backup was created')
manifest_path = destination / 'manifest.json'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
os.chmod(manifest_path, 0o600)
for path in (*[destination / value['file'] for value in manifest['databases']], manifest_path):
    subprocess.run(['python3', str(base / 'deploy' / 'blob.py'), 'upload', 'backups', destination.name + '/' + path.name, str(path)], check=True)
print('Verified off-host snapshot:', destination.name)
# Keep the newest completed local snapshot only; the private off-host copies retain history.
# Removing local copies happens only after all current files were uploaded successfully.
for prior in (base / 'backups').iterdir():
    if prior != destination and prior.is_dir() and not prior.is_symlink() and re.fullmatch(r'[0-9]{8}T[0-9]{6}\.[0-9]{6}Z', prior.name):
        shutil.rmtree(prior)
