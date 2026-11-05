"""Exact resource names must be checked even on case-insensitive file systems."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid
import zipfile

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / 'skills/game-compatibility-audit/scripts/check_resource_paths.py'
sys.path.insert(0, str(SCRIPT.parent))
from check_resource_paths import audit


class ResourcePathsTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(os.environ.get('AUDIT_TEST_ROOT', REPO / 'test-results')) / uuid.uuid4().hex
        self.game = self.root / 'game'
        self.game.mkdir(parents=True)

    def write(self, name, text):
        target = self.game / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def zip(self):
        target = self.root / 'game.zip'
        with zipfile.ZipFile(target, 'w') as output:
            for file in self.game.rglob('*'):
                if file.is_file():
                    output.write(file, file.relative_to(self.game).as_posix())
        return target

    def test_case_mismatch_in_zip_and_directory_then_fix(self):
        self.write('index.html', '<img loading="lazy" src="./assets/Frame.webp">')
        self.write('assets/frame.webp', 'fixture')
        for target in (self.game, self.zip()):
            with self.subTest(target=target):
                result = audit(target)
                self.assertFalse(result['passed'])
                self.assertEqual(result['issues'][0]['kind'], 'case_mismatch')
                self.assertEqual(result['issues'][0]['actualNames'], ['assets/frame.webp'])
        self.write('index.html', '<img loading="lazy" src="./assets/frame.webp">')
        self.assertTrue(audit(self.game)['passed'])

    def test_css_import_nested_paths_encoding_and_fragments(self):
        self.write('index.html', '<link href="styles/main.css?v=2"><style>.x{background:url(assets/cat%20face.svg#face)}</style>')
        self.write('styles/main.css', '@import "nested/theme.css"; .x{background:url(../assets/cat%20face.svg?x=2#face)}')
        self.write('styles/nested/theme.css', '/* url(missing.png) */ .x{background:url(../../assets/cat%20face.svg)}')
        self.write('assets/cat face.svg', '<svg/>')
        result = audit(self.zip())
        self.assertTrue(result['passed'], result)
        self.assertEqual(len(result['checked']), 5)

    def test_missing_file_is_distinct_from_case_mismatch(self):
        self.write('index.html', '<img src="missing.png">')
        self.assertEqual(audit(self.game)['issues'][0]['kind'], 'missing')

    def test_memory_remote_and_anchor_urls_are_outside_path_scope(self):
        self.write('index.html', '<img src="data:image/png;base64,AA=="><img src="blob:test"><img src="https://example.invalid/a.png"><img src="#anchor">')
        result = audit(self.game)
        self.assertTrue(result['passed'])
        self.assertEqual(result['checked'], [])
        self.assertIn('CSP', ' '.join(result['limits']))

    def test_base_and_srcset_require_manual_review(self):
        self.write('index.html', '<base href="assets/"><img src="cat.png" srcset="cat.png 1x, cat2.png 2x">')
        result = audit(self.game)
        self.assertFalse(result['passed'])
        self.assertEqual(result['issues'], [])
        self.assertEqual(len(result['manualReviewRequired']), 2)

    def test_inline_style_poster_and_bom(self):
        self.write('index.html', '\ufeff<video poster="assets/cover.png"></video><div style="background:url(assets/background.png)"></div>')
        self.write('assets/cover.png', 'fixture')
        self.write('assets/background.png', 'fixture')
        result = audit(self.game)
        self.assertTrue(result['passed'])
        self.assertEqual(len(result['checked']), 2)

    def test_escaped_and_root_escaping_references_are_not_silently_accepted(self):
        self.write('index.html', '<img src="../outside.png"><style>.x{background:url(var(--photo))}</style>')
        result = audit(self.game)
        self.assertFalse(result['passed'])
        self.assertEqual(len(result['manualReviewRequired']), 2)

    def test_cli_exit_codes_and_read_only_behavior(self):
        for html, code in [('<img src="assets/frame.webp">', 0),
                           ('<img src="assets/Frame.webp">', 1),
                           ('<img srcset="assets/frame.webp 1x">', 2)]:
            self.write('index.html', html)
            self.write('assets/frame.webp', 'fixture')
            before = {p.relative_to(self.game): p.read_bytes() for p in self.game.rglob('*') if p.is_file()}
            run = subprocess.run([sys.executable, '-B', str(SCRIPT), str(self.game)], capture_output=True, encoding='utf-8')
            self.assertEqual(run.returncode, code, run.stderr)
            self.assertEqual(json.loads(run.stdout)['passed'], code == 0)
            self.assertEqual(before, {p.relative_to(self.game): p.read_bytes() for p in self.game.rglob('*') if p.is_file()})

    def test_unsafe_zip_is_rejected(self):
        target = self.root / 'unsafe.zip'
        with zipfile.ZipFile(target, 'w') as output:
            output.writestr('../outside.png', 'fixture')
        with self.assertRaises(ValueError):
            audit(target)


if __name__ == '__main__':
    unittest.main()
