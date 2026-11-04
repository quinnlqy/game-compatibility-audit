"""Validate coverage, proof binding and CURRENT bytes; not a test executor."""
import sys
sys.dont_write_bytecode = True
import argparse
import json
from pathlib import Path
from artifact_snapshot import snapshot, sha256_file


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(audit_path, require_device=False):
    errors, pending, device_pending = [], [], []
    audit_path = Path(audit_path).resolve(strict=True)
    audit = json.loads(audit_path.read_text(encoding='utf-8-sig'))
    catalog = json.loads((Path(__file__).resolve().parent.parent /
                          'references/regressions.json').read_text(encoding='utf-8'))
    if audit.get('schema_version') != 1:
        errors.append('Unsupported schema_version')
    if audit.get('catalog_revision') != catalog['revision']:
        errors.append('Catalog changed: review added/changed cases before claiming completion')
    catalog_ids = {case['id'] for case in catalog['cases']}
    scope = audit.get('scope', {'mode': 'full', 'case_ids': sorted(catalog_ids)})
    if not isinstance(scope, dict):
        errors.append('Scope must be an object')
        scope = {}
    selected_ids = scope.get('case_ids', [])
    if (scope.get('mode') not in {'full', 'targeted'} or
            not isinstance(selected_ids, list) or
            not all(isinstance(case_id, str) for case_id in selected_ids)):
        errors.append('Invalid scope mode or case_ids')
        selected_ids = []
    if len(set(selected_ids)) != len(selected_ids) or not set(selected_ids) <= catalog_ids:
        errors.append('Unknown or duplicate scope case IDs')
    selected_ids = set(selected_ids) & catalog_ids
    if 'P03' not in selected_ids:
        errors.append('Artifact audits must include P03')
    if scope.get('mode') == 'full' and selected_ids != catalog_ids:
        errors.append('Full audit must include every catalog case')
    targets = {}
    for target in audit.get('targets', []):
        target_id = target.get('id')
        if not nonempty(target_id) or target_id in targets:
            errors.append(f'Invalid or duplicate target: {target_id}')
            continue
        targets[target_id] = target
        try:
            current = snapshot(target['path'])
            if current['sha256'] != target.get('sha256'):
                errors.append(f'{target_id}: artifact bytes changed; rerun tests and update snapshot')
            if current['kind'] == 'directory' and audit_path.is_relative_to(Path(current['path'])):
                errors.append(f'{target_id}: audit is inside the measured artifact')
            entry = target.get('entry', '')
            if not nonempty(entry):
                pending.append(f'{target_id}: actual entry not recorded')
            elif entry.startswith(('/', '\\')) or ':' in entry or '..' in entry.replace('\\', '/').split('/'):
                errors.append(f'{target_id}: unsafe entry {entry}')
            elif 'manifest' in current:
                if entry.replace('\\', '/') not in {m['path'] for m in current['manifest']}:
                    errors.append(f'{target_id}: entry not found in artifact: {entry}')
            elif entry != Path(current['path']).name:
                errors.append(f'{target_id}: single-file entry must be the file name')
        except (OSError, ValueError, KeyError) as error:
            errors.append(f'{target_id}: cannot fingerprint artifact: {error}')
    if not targets:
        errors.append('No targets')

    def proof_list(case, field, stage, expected_sha):
        label = f"{case.get('target_id')}/{case.get('id')}/{field}"
        proofs = case.get(field)
        if not isinstance(proofs, list) or not proofs:
            errors.append(f'{label}: missing evidence')
            return
        for evidence in proofs:
            try:
                path = Path(evidence['file'])
                path = path if path.is_absolute() else audit_path.parent / path
                if sha256_file(path) != evidence.get('sha256'):
                    raise ValueError('evidence file SHA256 mismatch')
                proof = json.loads(path.read_text(encoding='utf-8-sig'))
                for key, expected in [('case_id', case['id']), ('target_id', case['target_id']),
                                      ('target_sha256', expected_sha), ('stage', stage), ('passed', True)]:
                    if proof.get(key) != expected or (key == 'passed' and proof.get(key) is not True):
                        raise ValueError(f'proof {key} does not match {expected!r}')
                checks = proof.get('checks')
                if not isinstance(checks, list) or not checks:
                    raise ValueError('proof needs actual action/expected/observed checks')
                for check in checks:
                    if check.get('pass') is not True or not all(nonempty(check.get(key)) for key in
                                                                 ('action', 'expected', 'observed')):
                        raise ValueError('proof contains failed or empty checks')
                if stage == 'device':
                    device = proof.get('device', {})
                    if device.get('real_device') is not True or not all(nonempty(device.get(key)) for key in
                                                                          ('model', 'os', 'host_version', 'build')):
                        raise ValueError('device evidence needs real device, model, OS, host version and build')
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                errors.append(f'{label}: {error}')

    expected = {(target_id, case_id) for target_id in targets for case_id in selected_ids}
    seen = set()
    for case in audit.get('cases', []):
        pair = (case.get('target_id'), case.get('id'))
        label = '/'.join(str(x) for x in pair)
        if pair not in expected or pair in seen:
            errors.append(f'{label}: unknown or duplicate case/target pair')
            continue
        seen.add(pair)
        applicability = case.get('applicability')
        status = case.get('local_status')
        device_status = case.get('device_status')
        if applicability not in {'unreviewed', 'applicable', 'not_applicable'}:
            errors.append(f'{label}: invalid applicability')
        if status not in {'not_run', 'passed', 'fixed', 'failed', 'blocked'}:
            errors.append(f'{label}: invalid local_status')
        if device_status not in {'pending', 'passed', 'not_applicable'}:
            errors.append(f'{label}: invalid device_status')
        if applicability == 'unreviewed':
            pending.append(f'{label}: applicability unreviewed')
            if status in {'passed', 'fixed'}:
                errors.append(f'{label}: unreviewed case cannot pass')
            continue
        if not nonempty(case.get('reason')):
            errors.append(f'{label}: explain applicability')
        if applicability == 'not_applicable':
            if case['id'] == 'P03':
                errors.append(f'{label}: final artifact verification is always applicable')
            if status in {'passed', 'fixed'}:
                errors.append(f'{label}: not applicable is not a test pass')
            continue
        target = targets[pair[0]]
        if status in {'passed', 'fixed'}:
            proof_list(case, 'evidence', 'after', target.get('sha256'))
        else:
            pending.append(f'{label}: {status}')
        if status == 'fixed':
            baseline = target.get('baseline_sha256')
            if not isinstance(baseline, str) or len(baseline) != 64:
                errors.append(f'{label}: fixed case needs baseline_sha256')
            try:
                if snapshot(target['baseline_path'])['sha256'] != baseline:
                    errors.append(f'{label}: baseline bytes changed; preserve the actual original artifact')
            except (KeyError, ValueError, OSError) as error:
                errors.append(f'{label}: original baseline artifact unavailable: {error}')
            proof_list(case, 'reproduction_evidence', 'before', baseline)
        if device_status == 'passed':
            proof_list(case, 'device_evidence', 'device', target.get('sha256'))
        elif device_status == 'not_applicable':
            errors.append(f'{label}: applicable case cannot mark phone testing not_applicable; use pending')
        else:
            device_pending.append(label)
    for target_id, case_id in sorted(expected - seen):
        errors.append(f'{target_id}/{case_id}: missing case')
    local_complete = not errors and not pending
    return {'valid': not errors, 'scope': scope.get('mode'),
            'selected_cases_per_target': len(selected_ids), 'catalog_cases': len(catalog_ids),
            'local_complete': local_complete,
            'device_complete': local_complete and not device_pending,
            'errors': errors, 'pending': pending, 'device_pending': device_pending,
            'required_complete': local_complete and (not require_device or not device_pending)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audit', type=Path)
    completion = parser.add_mutually_exclusive_group()
    completion.add_argument('--allow-incomplete', action='store_true',
                            help='Accept honest pending work, never invalid evidence')
    completion.add_argument('--require-device', action='store_true',
                            help='Require complete local and real-device evidence; cannot allow incomplete')
    args = parser.parse_args()
    result = validate(args.audit, args.require_device)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['valid'] and (result['required_complete'] or args.allow_incomplete) else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, TypeError, AttributeError) as error:
        print(json.dumps({'valid': False, 'local_complete': False, 'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
