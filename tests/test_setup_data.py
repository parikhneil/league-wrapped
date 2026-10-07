import contextlib
import io
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

import setup_data


class SetupPipelineTests(unittest.TestCase):
    def run_setup(self, arguments, failures=()):
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            return SimpleNamespace(returncode=1 if command[1] in failures else 0)

        fake_espn = SimpleNamespace(credentials=lambda path: ('configured', 'configured'))
        with mock.patch.object(sys, 'argv', ['setup_data.py', *arguments]), \
                mock.patch.dict(sys.modules, {'fetch_espn_details': fake_espn}), \
                mock.patch.object(setup_data.os, 'chdir'), \
                mock.patch.object(setup_data.subprocess, 'run', side_effect=run), \
                contextlib.redirect_stdout(io.StringIO()):
            setup_data.main()
        return calls

    def test_skipping_optional_imports_still_rebuilds_final_reports(self):
        calls = self.run_setup(['--espn-only', '--skip-nfl', '--skip-comebacks'])
        self.assertEqual([command[1] for command, _ in calls], ['fetch_espn_details.py', 'build_report.py'])
        self.assertTrue(calls[-1][1]['check'])

    def test_optional_public_source_failures_do_not_prevent_final_build(self):
        calls = self.run_setup([], failures=('fetch_nfl_opportunity.py', 'fetch_comeback_history.py'))
        scripts = [command[1] for command, _ in calls]
        self.assertEqual(scripts[-1], 'build_report.py')
        self.assertLess(scripts.index('fetch_nfl_opportunity.py'), scripts.index('fetch_comeback_history.py'))
        self.assertFalse(calls[-2][1]['check'])
        self.assertTrue(calls[-1][1]['check'])


if __name__ == '__main__':
    unittest.main()
