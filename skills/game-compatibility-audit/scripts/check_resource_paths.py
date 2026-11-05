"""Read-only HTML/CSS path checks against exact artifact names, not OS lookup rules."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote, urlsplit
import zipfile

from artifact_snapshot import snapshot


def css_urls(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    pattern = r'''url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)'''
    for match in re.finditer(pattern, text, flags=re.I):
        yield next(value for value in match.groups() if value is not None)
    for match in re.finditer(r'''@import\s+["']([^"']+)["']''', text, flags=re.I):
        yield match.group(1)


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []
        self.review = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for name in ('src', 'poster'):
            if attrs.get(name):
                self.urls.append(attrs[name])
        if tag == 'link' and attrs.get('href'):
            self.urls.append(attrs['href'])
        if tag == 'base' and 'href' in attrs:
            self.review.append('base href changes URL resolution; resolve it with the project loader')
        if attrs.get('srcset') or attrs.get('imagesrcset'):
            self.review.append('srcset/imagesrcset needs project-specific URL parsing')
        if attrs.get('style'):
            self.urls.extend(css_urls(attrs['style']))
        if tag == 'style':
            self.in_style = True

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.urls.extend(css_urls(data))


def resolve_reference(owner, reference):
    """Resolve lexically; Path.resolve/exists may normalize case on the host OS."""
    value = reference.strip()
    if not value or value.startswith('#'):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None  # This tool does not certify remote URLs or platform policy.
    path = unquote(parsed.path)
    if not path:
        return None
    if '\\' in path or any(marker in path for marker in ('${', '{{', 'var(')):
        raise ValueError('escaped or dynamic URL needs manual resolution')
    parts = [] if path.startswith('/') else list(PurePosixPath(owner).parent.parts)
    for part in path.split('/'):
        if part in ('', '.'):
            continue
        if part == '..':
            if not parts:
                raise ValueError('reference escapes artifact root')
            parts.pop()
        else:
            parts.append(part)
    return '/'.join(parts)


def audit(path):
    artifact = snapshot(path)
    if 'manifest' not in artifact:
        raise ValueError('Expected an artifact ZIP or build directory')
    root = Path(artifact['path'])
    names = {entry['path'] for entry in artifact['manifest']}
    folded = {}
    for name in names:
        folded.setdefault(name.casefold(), []).append(name)
    archive = zipfile.ZipFile(root) if root.is_file() else None
    try:
        if archive and any('\\' in entry.filename for entry in archive.infolist()):
            raise ValueError('ZIP paths must use forward slashes')
        issues, reviews, checked = [], [], []
        for owner in sorted(names):
            suffix = PurePosixPath(owner).suffix.lower()
            if suffix not in ('.html', '.htm', '.css'):
                continue
            raw = archive.read(owner) if archive else (root / owner).read_bytes()
            try:
                text = raw.decode('utf-8-sig')
            except UnicodeDecodeError:
                reviews.append({'file': owner, 'reason': 'Non-UTF-8 text; use the project encoding'})
                continue
            if suffix == '.css':
                urls = list(css_urls(text))
            else:
                parser = References()
                parser.feed(text)
                reviews.extend({'file': owner, 'reason': reason} for reason in parser.review)
                # A base URL can change all references in this document. Do not report
                # false missing files using a resolution base we know is unsupported.
                urls = [] if any('base href' in reason for reason in parser.review) else parser.urls
            for reference in dict.fromkeys(urls):
                try:
                    resolved = resolve_reference(owner, reference)
                except ValueError as error:
                    reviews.append({'file': owner, 'reference': reference, 'reason': str(error)})
                    continue
                if resolved is None:
                    continue
                record = {'file': owner, 'reference': reference, 'resolved': resolved}
                checked.append(record)
                if resolved not in names:
                    alternatives = sorted(folded.get(resolved.casefold(), []))
                    issues.append({**record, 'kind': 'case_mismatch' if alternatives else 'missing',
                                   'actualNames': alternatives})
        return {'artifact': {key: artifact[key] for key in ('path', 'kind', 'sha256', 'bytes')},
                'scope': 'static HTML src/poster, link href, inline CSS and CSS url/import',
                'passed': not issues and not reviews, 'checked': checked,
                'issues': issues, 'manualReviewRequired': reviews,
                'limits': ['Does not evaluate JS, dynamic URLs, srcset, SVG references or base href',
                           'Does not certify remote dependencies, CSP, runtime mapping or interactions',
                           'Root-relative URLs are checked from artifact root; deployment prefixes need runtime tests']}
    finally:
        if archive:
            archive.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', help='Final ZIP or build directory; never rewritten')
    args = parser.parse_args()
    try:
        report = audit(args.artifact)
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        print(json.dumps({'passed': False, 'error': str(error)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report['issues'] else 2 if report['manualReviewRequired'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
