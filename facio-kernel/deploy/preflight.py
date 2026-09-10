#!/usr/bin/env python3
"""Replay a candidate on disposable business data before stopping the sandbox.

The runner supplies the exact candidate SHA and reviewed replay source. The
candidate sees copied business data and an EMPTY auth schema, never live paths,
session records, host credentials, the Docker socket or a network connection.
"""
import base64
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
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    """Bounded memory, compatible with the VM's Python 3.10."""
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def command(arguments, stdin=None, timeout=300):
    result = subprocess.run(arguments, input=stdin, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        # Database failures can include customer input. Keep runner output generic;
        # never forward arbitrary candidate stdout/stderr to workflow logs.
        raise RuntimeError('Candidate preflight failed at ' + arguments[0] + '; live container was not changed')
    return result.stdout.strip()


def copy_database(source, destination):
    require(source.is_file(), 'Expected initialized database is missing')
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as live:
        with sqlite3.connect(destination) as copied:
            live.backup(copied)
            require(copied.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Copied database integrity check failed')


def auth_schema_only(source, destination):
    """Keep schema/version compatibility evidence without any authentication rows."""
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(destination) as empty:
            # Explicit supported schema owners; unexpected tables fail closed so a
            # future auth schema cannot accidentally copy new credential material.
            definitions = original.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").fetchall()
            tables = {name for kind, name, _ in definitions if kind == 'table'}
            require(tables <= {'auth_entries', 'auth_grants', 'auth_schema_migrations'}, 'Unknown authentication schema owner')
            require({'auth_entries', 'auth_grants'} <= tables, 'Authentication schema is incomplete')
            for kind, _, sql in definitions:
                require(kind in {'table', 'index', 'trigger'}, 'Unexpected authentication schema object')
                empty.execute(sql)
            if 'auth_schema_migrations' in tables:
                empty.executemany('INSERT INTO auth_schema_migrations(version) VALUES(?)', original.execute('SELECT version FROM auth_schema_migrations').fetchall())
            require(empty.execute('SELECT COUNT(*) FROM auth_entries').fetchone()[0] == 0, 'Authentication entries must not reach candidate')
            require(empty.execute('SELECT COUNT(*) FROM auth_grants').fetchone()[0] == 0, 'Authentication grants must not reach candidate')
            require(empty.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Empty authentication schema is invalid')


def business_baseline(source):
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as database:
        tables = [row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name")]
        # Table names originate from SQLite; quoting also supports unusual legacy names.
        counts = {name: database.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in tables}
        records = database.execute('SELECT scope,id,version,record_hash FROM insurance_records ORDER BY scope,id').fetchall()
        return {'tableCounts': counts, 'records': [dict(zip(('scope', 'id', 'version', 'recordHash'), row)) for row in records]}


def main():
    os.umask(0o077)
    base = Path('/srv/facio-kernel')
    sha = os.environ['KERNEL_PREFLIGHT_SHA']
    require(re.fullmatch(r'[a-f0-9]{40}', sha), 'Exact candidate SHA is required')
    replay = base64.b64decode(os.environ['KERNEL_PREFLIGHT_REPLAY'], validate=True).decode()
    require(len(replay) <= 1024 * 1024 and replay.startswith('// Executes only inside an isolated, network-disabled candidate container'), 'Reviewed replay source is required')
    lock = (base / 'deploy.lock').open('r')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    live_before = command(['docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}}', 'facio-kernel'])
    storage = dict(line.split('=', 1) for line in (base / 'deploy/storage.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    os.environ['KERNEL_STORAGE_ACCOUNT'] = storage['KERNEL_STORAGE_ACCOUNT']
    del storage
    release = base / 'releases' / sha
    release.mkdir(mode=0o700, exist_ok=True)
    for filename in ('image.tar.gz', 'image.sha256'):
        command(['python3', str(base / 'deploy/blob.py'), 'download', 'releases', sha + '/' + filename, str(release / filename)])
    expected_archive_hash = (release / 'image.sha256').read_text().split()[0]
    require(re.fullmatch(r'[a-f0-9]{64}', expected_archive_hash), 'Invalid candidate archive checksum')
    require(digest(release / 'image.tar.gz') == expected_archive_hash, 'Candidate archive checksum differs')
    command(['docker', 'load', '--input', str(release / 'image.tar.gz')])
    image = 'facio-kernel:' + sha
    require(command(['docker', 'image', 'inspect', image, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}']) == sha, 'Candidate image label differs')
    image_id = command(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'])
    destination = base / 'recovery' / ('candidate-' + sha[:12] + '-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    require(destination.resolve().parent == (base / 'recovery').resolve(), 'Invalid disposable copy path')
    original = destination / 'original'
    work = destination / 'work'
    original.mkdir(mode=0o700)
    work.mkdir(mode=0o700)
    require(work.resolve() != (base / 'data').resolve(), 'Disposable data must be separate from live data')
    databases = []
    for name in ('kernel.sqlite', 'auth.sqlite'):
        source = base / 'data' / name
        require(source.resolve().parent == (base / 'data').resolve(), 'Database symlink escapes the data directory')
        copy_database(source, original / name)
        databases.append({'file': name, 'sha256': digest(original / name)})
    shutil.copyfile(original / 'kernel.sqlite', work / 'kernel.sqlite')
    auth_schema_only(original / 'auth.sqlite', work / 'auth.sqlite')
    baseline = original / 'baseline.json'
    baseline.write_text(json.dumps(business_baseline(original / 'kernel.sqlite')) + '\n')
    container = 'facio-kernel-preflight-' + uuid.uuid4().hex
    try:
        result = json.loads(command(['docker', 'run', '--rm', '--name', container, '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '1g', '--cpus', '2', '--pids-limit', '128', '--user', '0', '--mount', 'type=bind,source=' + str(work) + ',target=/data', '--mount', 'type=bind,source=' + str(baseline) + ',target=/replay-baseline.json,readonly', '--env', 'KERNEL_ISOLATED_REPLAY=true', '--entrypoint', 'node', image_id, '--no-warnings', '--input-type=module'], stdin=replay))
    finally:
        # Killing a timed-out docker CLI does not stop its container. Explicitly
        # remove only our UUID-named disposable worker, including error paths.
        subprocess.run(['docker', 'rm', '--force', container], capture_output=True, timeout=30)
    require(result['passed'] is True and result['moneyEngine']['engine'] == 'rust-wasm' and result['baselineVerified'] is True and result['authDataRowsMounted'] == 0, 'Candidate replay did not prove the required checks')
    for entry in databases:
        require(digest(original / entry['file']) == entry['sha256'], 'Original copy changed during replay')
    require(command(['docker', 'inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}}', 'facio-kernel']) == live_before, 'Live container identity changed during replay')
    evidence = {'buildSha': sha, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'imageId': image_id, 'imageArchiveSha256': expected_archive_hash, 'replaySourceSha256': hashlib.sha256(replay.encode()).hexdigest(), 'originalDatabases': databases, 'replay': result, 'liveContainerUnchanged': True, 'liveDataOverwritten': False, 'credentialsMounted': False, 'authMount': 'empty_schema_only', 'network': 'none', 'limits': ['Each original database is independently consistent; cross-database atomicity is not claimed.', 'Authentication data rows are not replayed; only schema compatibility is checked inside the candidate.', 'This checks copied persisted business evidence, not customer acceptance or full VM-loss recovery.']}
    receipt = destination / 'evidence.json'
    receipt.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'passed': True, 'buildSha': sha, 'businessSchema': result['businessSchema'], 'moneyEngine': result['moneyEngine'], 'verifiedRecords': len(result['records']), 'evidenceFile': str(receipt), 'evidenceSha256': digest(receipt), 'liveContainerUnchanged': True}))


if __name__ == '__main__':
    main()
