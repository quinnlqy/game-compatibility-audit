"""Create an UNTESTED audit plan; never infer applicability or success."""
import sys
sys.dont_write_bytecode = True
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from artifact_snapshot import snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path)
    parser.add_argument('--target', action='append', default=[], metavar='ID=PATH')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--case', action='append', default=[], dest='case_ids',
                        help='Stable case ID; repeat for a targeted audit. P03 is always included.')
    parser.add_argument('--snapshot', type=Path, help='Print one fingerprint without writing a plan')
    args = parser.parse_args()
    if args.snapshot:
        if args.target or args.out or args.project or args.case_ids:
            parser.error('--snapshot cannot be combined with plan arguments')
        print(json.dumps(snapshot(args.snapshot), ensure_ascii=False, indent=2))
        return
    if not (args.project and args.project.is_dir() and args.target and args.out):
        parser.error('Provide an existing --project, at least one --target ID=PATH, and --out')
    out = args.out.resolve()
    if out.exists():
        parser.error(f'Refusing to overwrite {out}')
    targets = []
    ids = set()
    for value in args.target:
        target_id, separator, path = value.partition('=')
        if not separator or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', target_id):
            parser.error(f'Invalid --target {value!r}')
        if target_id in ids:
            parser.error(f'Duplicate target {target_id}')
        ids.add(target_id)
        target = snapshot(path)
        if target['kind'] == 'directory' and out.is_relative_to(Path(target['path'])):
            parser.error('Audit output must be outside the artifact directory')
        target.update({'id': target_id, 'entry': '', 'baseline_sha256': target['sha256'],
                       'baseline_path': target['path']})
        targets.append(target)
    catalog = json.loads((Path(__file__).resolve().parent.parent /
                          'references/regressions.json').read_text(encoding='utf-8'))
    all_ids = {case['id'] for case in catalog['cases']}
    if set(args.case_ids) - all_ids:
        parser.error(f'Unknown case IDs: {sorted(set(args.case_ids) - all_ids)}')
    selected_ids = (set(args.case_ids) | {'P03'}) if args.case_ids else all_ids
    selected_cases = [case for case in catalog['cases'] if case['id'] in selected_ids]
    audit = {'schema_version': 1, 'catalog_revision': catalog['revision'],
             'scope': {'mode': 'targeted' if args.case_ids else 'full',
                       'case_ids': [case['id'] for case in selected_cases]},
             'created_at': datetime.now(timezone.utc).isoformat(),
             'project': str(args.project.resolve()), 'targets': targets,
             'cases': [{'id': case['id'], 'target_id': target['id'], 'title': case['title'],
                        'applicability': 'unreviewed', 'reason': '',
                        'local_status': 'not_run', 'device_status': 'pending',
                        'notes': '', 'evidence': [], 'reproduction_evidence': [],
                        'device_evidence': []}
                       for target in targets for case in selected_cases]}
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('x', encoding='utf-8', newline='\n') as destination:
        json.dump(audit, destination, ensure_ascii=False, indent=2)
        destination.write('\n')
    print(json.dumps({'audit': str(out), 'targets': len(targets), 'cases': len(audit['cases']),
                      'scope': audit['scope']['mode'],
                      'local_complete': False}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        raise SystemExit(str(error))
