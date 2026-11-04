"""Synthetic tool fixtures only; these tests do not audit or certify a game."""
import sys
sys.dont_write_bytecode = True
import copy
import json
import os
from pathlib import Path
import subprocess
import unittest
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[1]
SKILL = REPO / 'skills/game-compatibility-audit'
sys.path.insert(0, str(SKILL / 'scripts'))
from artifact_snapshot import snapshot, sha256_file
from validate_audit import validate


class AuditToolsTest(unittest.TestCase):
    def setUp(self):
        # Keep fixtures for diagnosis; no test cleanup can delete a user target.
        base = Path(os.environ.get('AUDIT_TEST_ROOT', REPO / 'test-results')).resolve()
        self.root = base / uuid.uuid4().hex
        self.artifact = self.root / 'game'
        self.artifact.mkdir(parents=True)
        (self.artifact / 'index.html').write_text('<p>synthetic fixture</p>', encoding='utf-8')
        self.audit_path = self.root / 'audit.json'

    def init(self, cases=None, out=None):
        command = [sys.executable, '-B', str(SKILL / 'scripts/init_audit.py'),
                   '--project', str(self.root), '--target', f'web={self.artifact}',
                   '--out', str(out or self.audit_path)]
        for case_id in cases or []:
            command.extend(['--case', case_id])
        return subprocess.run(command, capture_output=True, text=True, encoding='utf-8')

    def load(self):
        return json.loads(self.audit_path.read_text(encoding='utf-8'))

    def save(self, audit):
        self.audit_path.write_text(json.dumps(audit), encoding='utf-8')

    def completed_fixture(self):
        self.assertEqual(self.init(['V07']).returncode, 0)
        audit = self.load()
        audit['targets'][0]['entry'] = 'index.html'
        for case in audit['cases']:
            proof = {'case_id': case['id'], 'target_id': 'web',
                     'target_sha256': audit['targets'][0]['sha256'], 'stage': 'after',
                     'passed': True, 'checks': [{'action': 'Read synthetic fixture file',
                       'expected': 'Fixture content exists', 'observed': 'Fixture read', 'pass': True}]}
            path = self.root / f"{case['id']}-proof.json"
            path.write_text(json.dumps(proof), encoding='utf-8')
            case.update(applicability='applicable', reason='Synthetic validator fixture',
                        local_status='passed', evidence=[{'file': path.name, 'sha256': sha256_file(path)}])
        self.save(audit)
        return audit

    def test_catalog_has_unique_complete_records(self):
        catalog = json.loads((SKILL / 'references/regressions.json').read_text(encoding='utf-8'))
        ids = [case['id'] for case in catalog['cases']]
        self.assertEqual(len(ids), 49)
        self.assertEqual(len(ids), len(set(ids)))
        for case in catalog['cases']:
            self.assertTrue(all(isinstance(case.get(key), str) and case[key].strip()
                                for key in ('id', 'category', 'title', 'when', 'reproduce',
                                            'repair', 'verify', 'evidence_notes')))

    def test_directory_snapshot_tracks_content(self):
        first = snapshot(self.artifact)
        self.assertEqual(first, snapshot(self.artifact))
        (self.artifact / 'index.html').write_text('changed', encoding='utf-8')
        self.assertNotEqual(first['sha256'], snapshot(self.artifact)['sha256'])

    def test_zip_rejects_traversal_and_duplicates(self):
        for index, names in enumerate([['../escape'], ['a', 'a'], ['C:/escape'], ['/absolute']]):
            path = self.root / f'unsafe-{index}.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                for name in names:
                    archive.writestr(name, 'fixture')
            with self.subTest(names=names), self.assertRaises(ValueError):
                snapshot(path)

    def test_full_plan_remains_unreviewed(self):
        self.assertEqual(self.init().returncode, 0)
        audit = self.load()
        self.assertEqual(audit['scope']['mode'], 'full')
        self.assertEqual(len(audit['cases']), 49)
        result = validate(self.audit_path)
        self.assertTrue(result['valid'])
        self.assertFalse(result['local_complete'])
        self.assertFalse(result['device_complete'])

    def test_targeted_plan_keeps_artifact_check(self):
        self.assertEqual(self.init(['V07', 'V07']).returncode, 0)
        audit = self.load()
        self.assertEqual(audit['scope']['mode'], 'targeted')
        self.assertEqual(set(audit['scope']['case_ids']), {'V07', 'P03'})
        self.assertEqual(len(audit['cases']), 2)

    def test_unknown_case_rejected_without_report(self):
        self.assertNotEqual(self.init(['NO_SUCH_CASE']).returncode, 0)
        self.assertFalse(self.audit_path.exists())

    def test_refuses_overwrite_and_output_inside_target(self):
        self.assertEqual(self.init(['P03']).returncode, 0)
        content = self.audit_path.read_bytes()
        self.assertNotEqual(self.init(['V07']).returncode, 0)
        self.assertEqual(self.audit_path.read_bytes(), content)
        inside = self.artifact / 'audit.json'
        self.assertNotEqual(self.init(out=inside).returncode, 0)
        self.assertFalse(inside.exists())

    def test_local_pass_is_scoped_and_not_device_pass(self):
        self.completed_fixture()
        result = validate(self.audit_path)
        self.assertTrue(result['local_complete'])
        self.assertEqual(result['scope'], 'targeted')
        self.assertEqual(result['selected_cases_per_target'], 2)
        self.assertEqual(result['catalog_cases'], 49)
        self.assertFalse(result['device_complete'])
        self.assertFalse(validate(self.audit_path, require_device=True)['required_complete'])

    def test_changed_bytes_reject_old_proof(self):
        self.completed_fixture()
        (self.artifact / 'index.html').write_text('changed', encoding='utf-8')
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_invalid_evidence_rejected(self):
        audit = self.completed_fixture()
        proof_path = self.root / audit['cases'][0]['evidence'][0]['file']
        proof = json.loads(proof_path.read_text(encoding='utf-8'))
        proof['checks'][0]['observed'] = ''
        proof_path.write_text(json.dumps(proof), encoding='utf-8')
        audit['cases'][0]['evidence'][0]['sha256'] = sha256_file(proof_path)
        self.save(audit)
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_scope_cannot_drop_artifact_or_fake_full(self):
        audit = self.completed_fixture()
        for modified in [dict(mode='targeted', case_ids=['V07']),
                         dict(mode='full', case_ids=['V07', 'P03']),
                         dict(mode='targeted', case_ids=['P03', 'NO_SUCH_CASE']),
                         dict(mode='targeted', case_ids=['P03', 'P03']), None]:
            with self.subTest(scope=modified):
                changed = copy.deepcopy(audit)
                changed['scope'] = modified
                self.save(changed)
                self.assertFalse(validate(self.audit_path)['valid'])

    def test_missing_case_and_missing_entry_rejected(self):
        audit = self.completed_fixture()
        missing_case = copy.deepcopy(audit)
        missing_case['cases'].pop()
        self.save(missing_case)
        self.assertFalse(validate(self.audit_path)['valid'])
        audit['targets'][0]['entry'] = 'missing.html'
        self.save(audit)
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_fixed_requires_original_and_before_proof(self):
        audit = self.completed_fixture()
        audit['cases'][0]['local_status'] = 'fixed'
        self.save(audit)
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_phone_pass_requires_device_metadata(self):
        audit = self.completed_fixture()
        audit['cases'][0]['device_status'] = 'passed'
        audit['cases'][0]['device_evidence'] = audit['cases'][0]['evidence']
        self.save(audit)
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_artifact_not_applicable_rejected(self):
        audit = self.completed_fixture()
        case = next(case for case in audit['cases'] if case['id'] == 'P03')
        case.update(applicability='not_applicable', local_status='not_run', reason='Synthetic bad claim')
        self.save(audit)
        self.assertFalse(validate(self.audit_path)['valid'])

    def test_allow_incomplete_never_accepts_tampering(self):
        self.assertEqual(self.init(['P03']).returncode, 0)
        command = [sys.executable, '-B', str(SKILL / 'scripts/validate_audit.py'),
                   str(self.audit_path), '--allow-incomplete']
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
        (self.artifact / 'index.html').write_text('changed', encoding='utf-8')
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_device_gate_cannot_allow_incomplete(self):
        self.completed_fixture()
        command = [sys.executable, '-B', str(SKILL / 'scripts/validate_audit.py'),
                   str(self.audit_path), '--require-device', '--allow-incomplete']
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)


if __name__ == '__main__':
    unittest.main()
