"""Safety regressions for the deployment recovery helper; no cloud or DB required."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('platform_backup', Path(__file__).with_name('backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupSafety(unittest.TestCase):
    def test_restore_target_cannot_be_live_or_operator_supplied_name(self):
        for value in ('facio_gen2', 'postgres', 'platform_restore_existing', 'platform_restore_' + '0' * 31, 'platform_restore_' + 'x' * 32):
            with self.assertRaises(RuntimeError):
                backup.assert_restore_target(value)
        backup.assert_restore_target('platform_restore_' + 'a' * 32)

    def test_failed_creation_never_drops_an_existing_database(self):
        with patch.object(backup, 'command', side_effect=subprocess.CalledProcessError(1, ['createdb'])) as command:
            with self.assertRaises(subprocess.CalledProcessError):
                backup.verify_restore(Path('unused'), {})
        self.assertEqual(command.call_count, 1)
        self.assertEqual(command.call_args.args[0][0], 'createdb')

    def test_failed_restore_still_removes_only_the_owned_random_database(self):
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            if args[0] == 'pg_restore':
                raise RuntimeError('deliberately damaged dump')
            stdout = 'kernel_owner\n' if 'pg_get_userbyid' in ' '.join(args) else '0\n'
            return subprocess.CompletedProcess(args, 0, stdout=stdout)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'backup.dump'; path.write_bytes(b'broken')
            with patch.object(backup, 'command', side_effect=command):
                with self.assertRaisesRegex(RuntimeError, 'damaged'):
                    backup.verify_restore(path, {})
        created = calls[0][-1]
        backup.assert_restore_target(created)
        self.assertIn(['dropdb', '-U', 'kernel_owner', '--force', created], calls)
        self.assertFalse(any(args[0] == 'dropdb' and args[-1] == backup.DATABASE for args in calls))

    def test_owner_mismatch_refuses_cleanup(self):
        def command(args, **kwargs):
            if args[0] == 'pg_restore': raise RuntimeError('damaged dump')
            if args[0] == 'dropdb': self.fail('Unexpected destructive cleanup')
            return subprocess.CompletedProcess(args, 0, stdout='other_owner\n')
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'backup.dump'; path.write_bytes(b'broken')
            with patch.object(backup, 'command', side_effect=command):
                with self.assertRaisesRegex(RuntimeError, 'unexpected database owner'):
                    backup.verify_restore(path, {})


if __name__ == '__main__':
    unittest.main()
