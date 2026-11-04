"""Deterministic, read-only artifact fingerprints. Python standard library only."""
from pathlib import Path
import hashlib
import zipfile


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot(path):
    root = Path(path).resolve(strict=True)
    if root.is_file():
        result = {'path': str(root), 'kind': 'file', 'sha256': sha256_file(root),
                  'bytes': root.stat().st_size}
        if zipfile.is_zipfile(root):
            with zipfile.ZipFile(root) as archive:
                names = set()
                manifest = []
                for item in archive.infolist():
                    name = item.filename.replace('\\', '/')
                    if (name.startswith('/') or ':' in name or '..' in name.split('/')
                            or name in names):
                        raise ValueError(f'Unsafe or duplicate ZIP member: {name}')
                    names.add(name)
                    if not item.is_dir():
                        with archive.open(item) as source:
                            digest = hashlib.sha256()
                            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                                digest.update(chunk)
                        manifest.append({'path': name, 'bytes': item.file_size,
                                         'sha256': digest.hexdigest()})
                result['manifest'] = sorted(manifest, key=lambda x: x['path'])
        return result
    if not root.is_dir():
        raise ValueError(f'Not an artifact file/directory: {root}')
    manifest = []
    for item in sorted(root.rglob('*')):
        if item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
            raise ValueError(f'Artifact must not contain links/junctions: {item}')
        if item.is_file():
            manifest.append({'path': item.relative_to(root).as_posix(),
                             'bytes': item.stat().st_size, 'sha256': sha256_file(item)})
    manifest.sort(key=lambda x: x['path'])
    digest = hashlib.sha256()
    for item in manifest:
        digest.update(f"{item['path']}\0{item['sha256']}\0{item['bytes']}\n".encode('utf-8'))
    return {'path': str(root), 'kind': 'directory', 'sha256': digest.hexdigest(),
            'bytes': sum(item['bytes'] for item in manifest), 'manifest': manifest}
