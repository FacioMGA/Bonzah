"""Offline tests: no Docker daemon, cloud session or live database is used."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preflight = load('candidate_preflight', 'preflight.py')
runner = load('candidate_runner', 'run-preflight.py')


class PreflightTests(unittest.TestCase):
    def test_authentication_copy_excludes_rows_and_preserves_future_schema_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'auth.sqlite'
            copied = Path(directory) / 'copy.sqlite'
            with sqlite3.connect(original) as database:
                database.executescript("CREATE TABLE auth_schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO auth_schema_migrations VALUES(99); CREATE TABLE auth_entries(kind TEXT,id TEXT,body TEXT,expires_at INTEGER,consumed INTEGER,PRIMARY KEY(kind,id)); CREATE TABLE auth_grants(id TEXT PRIMARY KEY,actor_id TEXT,client_id TEXT,expires_at INTEGER,revoked INTEGER); CREATE INDEX auth_grants_actor ON auth_grants(actor_id);")
                database.execute('INSERT INTO auth_entries VALUES(?,?,?,?,?)', ('session', 'tokenhash', 'DO_NOT_MOUNT_SESSION_CONTENT', 1234, 0))
                database.execute('INSERT INTO auth_grants VALUES(?,?,?,?,?)', ('grant', 'actor', 'client', 1234, 0))
            before = preflight.digest(original)
            preflight.auth_schema_only(original, copied)
            self.assertEqual(preflight.digest(original), before)
            self.assertNotIn(b'DO_NOT_MOUNT_SESSION_CONTENT', copied.read_bytes())
            with sqlite3.connect(copied) as database:
                self.assertEqual(database.execute('SELECT version FROM auth_schema_migrations').fetchall(), [(99,)])
                self.assertEqual(database.execute('SELECT COUNT(*) FROM auth_entries').fetchone()[0], 0)
                self.assertEqual(database.execute('SELECT COUNT(*) FROM auth_grants').fetchone()[0], 0)
                self.assertIsNotNone(database.execute("SELECT name FROM sqlite_master WHERE name='auth_grants_actor'").fetchone())

    def test_unknown_auth_owner_and_missing_source_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'auth.sqlite'
            with sqlite3.connect(original) as database:
                database.execute('CREATE TABLE future_auth_secrets(value TEXT)')
            with self.assertRaisesRegex(RuntimeError, 'Unknown authentication schema'):
                preflight.auth_schema_only(original, Path(directory) / 'empty.sqlite')
            with self.assertRaisesRegex(RuntimeError, 'missing'):
                preflight.copy_database(Path(directory) / 'missing.sqlite', Path(directory) / 'copy.sqlite')

    def test_stream_hash_read_only_backup_and_baseline_retain_heads(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'kernel.sqlite'
            copied = Path(directory) / 'copy.sqlite'
            with sqlite3.connect(original) as database:
                database.executescript('CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(6); CREATE TABLE insurance_records(scope TEXT,id TEXT,version INTEGER,record_hash TEXT); CREATE TABLE history(body BLOB);')
                database.execute('INSERT INTO insurance_records VALUES(?,?,?,?)', ('["workspace","tenant","sandbox","entity"]', 'id', 2, 'a' * 64))
                database.execute('INSERT INTO history VALUES(?)', (b'x' * 2100000,))
            before = hashlib.sha256(original.read_bytes()).hexdigest()
            self.assertEqual(preflight.digest(original), before)
            preflight.copy_database(original, copied)
            self.assertEqual(preflight.digest(original), before)
            with sqlite3.connect(copied) as database:
                self.assertEqual(database.execute('SELECT length(body) FROM history').fetchone()[0], 2100000)
            baseline = preflight.business_baseline(copied)
            self.assertEqual(baseline['tableCounts'], {'history': 1, 'insurance_records': 1})
            self.assertEqual(baseline['records'][0]['version'], 2)
            self.assertEqual(baseline['records'][0]['recordHash'], 'a' * 64)

    def test_runner_requires_exact_complete_stdout_receipt(self):
        import json
        sha = 'a' * 40
        receipt = {'buildSha': sha, 'passed': True, 'businessSchema': 7, 'moneyEngine': {'engine': 'rust-wasm', 'wasmSha256': 'b' * 64}, 'verifiedRecords': 2, 'evidenceFile': '/srv/facio-kernel/recovery/candidate-' + sha[:12] + '-20260907T100000.123456Z/evidence.json', 'evidenceSha256': 'c' * 64, 'liveContainerUnchanged': True}
        def payload(value, code='ComponentStatus/StdOut/succeeded'):
            return {'value': [{'code': code, 'message': json.dumps(value)}]}
        self.assertEqual(runner.success_receipt(payload(receipt), sha), receipt)
        combined = {'value': [{'code': 'ProvisioningState/succeeded', 'message': 'Enable succeeded: \n[stdout]\n' + json.dumps(receipt) + '\n[stderr]\n'}]}
        self.assertEqual(runner.success_receipt(combined, sha), receipt)
        warning = copy.deepcopy(combined)
        warning['value'][0]['message'] += 'Warning: synthetic harmless warning\n'
        self.assertEqual(runner.success_receipt(warning, sha), receipt)
        invalid = [payload(receipt, 'ComponentStatus/StdErr/succeeded'), payload(receipt, 'ComponentStatus/StdOut/failed'), {'value': []}]
        late_failure = copy.deepcopy(combined)
        late_failure['value'][0]['message'] += 'Traceback (most recent call last):\nRuntimeError: synthetic failure\n'
        invalid.append(late_failure)
        invalid.append({'value': [{'code': 'ProvisioningState/succeeded', 'message': 'Enable succeeded: \n[stdout]\n\n[stderr]\n' + json.dumps(receipt)}]})
        invalid.append({'value': [{'code': 'ProvisioningState/succeeded', 'message': 'Enable succeeded: \n[stdout]\n\n[stderr]\n'}]})
        duplicate = payload(receipt)
        duplicate['value'].append(copy.deepcopy(duplicate['value'][0]))
        invalid.append(duplicate)
        for key, value in [('buildSha', 'd' * 40), ('passed', False), ('businessSchema', 6), ('evidenceSha256', None), ('evidenceFile', '/srv/facio-kernel/data/evidence.json'), ('verifiedRecords', True), ('moneyEngine', {'engine': 'typescript'}), ('liveContainerUnchanged', False)]:
            invalid.append(payload({**receipt, key: value}))
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.success_receipt(value, sha)


if __name__ == '__main__':
    unittest.main()
