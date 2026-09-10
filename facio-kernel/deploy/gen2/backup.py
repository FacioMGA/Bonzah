#!/usr/bin/env python3
"""Consistent PostgreSQL backup, private Blob readback and isolated restore rehearsal.

Never restores into facio_gen2. The exported source snapshot remains open only
while pg_dump and its comparison metadata are captured. Session values are never
printed or inspected; the private dump necessarily retains authentication state.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import urllib.request
import uuid

BASE = ['docker', 'exec', '-i', 'facio-platform-postgres']
DATABASE = 'facio_gen2'
ROOT = Path('/srv/facio-platform/backups')
BLOB_ROOT = 'https://stkernelsandbox294904.blob.core.windows.net/backups/postgres/'
TIMEOUT = 180
# Each line is metadata only: names and counts, never table/session contents.
METADATA_SQL = """
SELECT format('SELECT json_build_object(''table'', %L, ''rows'', count(*))::text FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\\gexec
SELECT json_build_object('rls', COALESCE(json_agg(json_build_object('name', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity) ORDER BY relname), '[]'::json))::text
FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE nspname = 'public' AND relkind IN ('r', 'p');
SELECT json_build_object('policies', COALESCE(json_agg(json_build_object('table', tablename, 'name', policyname, 'roles', roles, 'cmd', cmd, 'qual', qual, 'check', with_check) ORDER BY tablename, policyname), '[]'::json))::text
FROM pg_policies WHERE schemaname = 'public';
"""


def command(arguments, **kwargs):
    return subprocess.run(BASE + arguments, check=True, timeout=TIMEOUT, **kwargs)


def metadata(lines):
    tables, rls, policies = {}, None, None
    for line in lines:
        item = json.loads(line)
        if 'table' in item:
            tables[item['table']] = item['rows']
        elif 'rls' in item:
            rls = item['rls']
        elif 'policies' in item:
            policies = item['policies']
    if not tables or rls is None or policies is None:
        raise RuntimeError('Incomplete backup comparison metadata')
    return {'tableCounts': tables, 'rowPolicies': policies, 'rls': rls}


def read_metadata(database):
    result = command(['psql', '-X', '-qAt', '-U', 'kernel_owner', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=METADATA_SQL, capture_output=True, text=True)
    return metadata(result.stdout.splitlines())


def create_snapshot(backup):
    """Pin counts and pg_dump to the same MVCC snapshot despite concurrent writes."""
    marker = 'snapshot_end_' + uuid.uuid4().hex
    with tempfile.TemporaryFile(mode='w+') as errors:
        session = subprocess.Popen(BASE + ['psql', '-X', '-qAt', '-U', 'kernel_owner', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, bufsize=1)
        deadline = threading.Timer(TIMEOUT + 30, session.kill)
        deadline.daemon = True
        deadline.start()
        try:
            session.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout = '120s';\nSELECT pg_export_snapshot();\n" + METADATA_SQL + f"SELECT '{marker}';\n")
            session.stdin.flush()
            snapshot = session.stdout.readline().strip()
            if not re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', snapshot):
                raise RuntimeError('Could not export a consistent PostgreSQL snapshot')
            lines = []
            for line in session.stdout:
                if line.strip() == marker:
                    break
                lines.append(line.strip())
            else:
                raise RuntimeError('Snapshot metadata capture did not complete')
            expected = metadata(lines)
            temporary = backup.with_suffix('.partial')
            with temporary.open('xb') as output:
                command(['pg_dump', '-U', 'kernel_owner', '-d', DATABASE, '--format=custom', '--no-owner', '--no-acl', '--snapshot', snapshot], stdout=output)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(backup)
            return expected
        finally:
            deadline.cancel()
            try:
                if session.poll() is None:
                    session.communicate('ROLLBACK;\n\\q\n', timeout=10)
            except (subprocess.TimeoutExpired, BrokenPipeError):
                session.kill()
                session.communicate(timeout=10)
            if session.poll() is None:
                raise RuntimeError('Snapshot export connection did not close')


def assert_restore_target(database):
    if database == DATABASE or not re.fullmatch(r'platform_restore_[a-f0-9]{32}', database):
        raise RuntimeError('Refusing unsafe restore database target')


def verify_restore(backup, expected):
    database = 'platform_restore_' + uuid.uuid4().hex
    assert_restore_target(database)
    command(['createdb', '-U', 'kernel_owner', '--template=template0', database], stdout=subprocess.DEVNULL)
    try:
        # No application role can connect to the disposable restored auth/business data.
        command(['psql', '-X', '-qAt', '-U', 'kernel_owner', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', f'REVOKE CONNECT ON DATABASE "{database}" FROM PUBLIC, kernel_app;'], stdout=subprocess.DEVNULL)
        with backup.open('rb') as source:
            command(['pg_restore', '-U', 'kernel_owner', '-d', database, '--exit-on-error', '--no-owner', '--no-acl'], stdin=source, stdout=subprocess.DEVNULL)
        if read_metadata(database) != expected:
            raise RuntimeError('Restored snapshot table counts or row policies differ')
    finally:
        # createdb must have succeeded for this block to run. Match both name and owner
        # before cleanup; never drop a preexisting database on a failed name collision.
        assert_restore_target(database)
        owner = command(['psql', '-X', '-qAt', '-U', 'kernel_owner', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-c', f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{database}';"], capture_output=True, text=True).stdout.strip()
        if owner != 'kernel_owner':
            raise RuntimeError('Restore cleanup refused an unexpected database owner')
        command(['dropdb', '-U', 'kernel_owner', '--force', database], stdout=subprocess.DEVNULL)
        remaining = command(['psql', '-X', '-qAt', '-U', 'kernel_owner', '-d', DATABASE, '-c', f"SELECT count(*) FROM pg_database WHERE datname = '{database}';"], capture_output=True, text=True).stdout.strip()
        if remaining != '0':
            raise RuntimeError('Restore database cleanup was not verified')


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def storage_token():
    request = urllib.request.Request('http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F', headers={'Metadata': 'true'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)['access_token']


def upload(path, token):
    with path.open('rb') as data:
        request = urllib.request.Request(BLOB_ROOT + path.name, data=data, method='PUT', headers={'Authorization': f'Bearer {token}', 'x-ms-version': '2023-11-03', 'x-ms-blob-type': 'BlockBlob', 'If-None-Match': '*', 'Content-Type': 'application/octet-stream', 'Content-Length': str(path.stat().st_size)})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 201:
                raise RuntimeError('Backup upload did not complete')


def readback(path, token, target):
    request = urllib.request.Request(BLOB_ROOT + path.name, headers={'Authorization': f'Bearer {token}', 'x-ms-version': '2023-11-03'})
    with urllib.request.urlopen(request, timeout=120) as response, target.open('xb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    if sha256(target) != sha256(path):
        raise RuntimeError('Off-host backup readback checksum mismatch')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-restore', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / '.backup.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        backup = ROOT / f'platform-{stamp}-{uuid.uuid4().hex}.dump'
        expected = create_snapshot(backup)
        with backup.open('rb') as source:
            command(['pg_restore', '--list'], stdin=source, stdout=subprocess.DEVNULL)
        token = storage_token()
        upload(backup, token)
        with tempfile.TemporaryDirectory(prefix='readback-', dir=ROOT) as temporary:
            recovered = Path(temporary) / backup.name
            readback(backup, token, recovered)
            if args.verify_restore:
                verify_restore(recovered, expected)
        receipt = {'file': backup.name, 'sha256': sha256(backup), 'restoreVerified': args.verify_restore, 'offHostSha256Verified': True, 'createdAt': stamp, 'comparison': expected}
        receipt_file = backup.with_suffix('.dump.json')
        receipt_file.write_text(json.dumps(receipt, sort_keys=True))
        upload(receipt_file, token)
        with tempfile.TemporaryDirectory(prefix='receipt-', dir=ROOT) as temporary:
            readback(receipt_file, token, Path(temporary) / receipt_file.name)
        print(json.dumps({key: value for key, value in receipt.items() if key != 'comparison'}))
        cutoff = datetime.datetime.now().timestamp() - 7 * 86400
        for path in ROOT.glob('platform-*.dump'):
            if path.stat().st_mtime < cutoff:
                path.unlink()
                path.with_suffix('.dump.json').unlink(missing_ok=True)


if __name__ == '__main__':
    main()
