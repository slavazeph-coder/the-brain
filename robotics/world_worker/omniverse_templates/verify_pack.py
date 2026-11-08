"""Verify a BrainSNN package after moving or extracting it; no network or GPU."""
from pathlib import Path
import hashlib,json,sys


def verify(root):
    root=root.resolve(); manifest=json.loads((root/'pack-files.json').read_text())
    if manifest.get('schema')!='brainsnn.portable-files.v1':raise ValueError('Invalid file manifest')
    seen=set()
    for row in manifest['files']:
        name=row['path']; p=root/name
        if name in seen or Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name or ':' in name:
            raise ValueError('Unsafe or duplicate path')
        seen.add(name)
        for part in [p,*p.parents]:
            if part==root:break
            if part.is_symlink():raise ValueError('Symlink rejected')
        if not p.is_file() or not p.resolve().is_relative_to(root) or p.stat().st_size!=row['size']:raise ValueError('Missing file: '+name)
        h=hashlib.sha256()
        with p.open('rb') as stream:
            for block in iter(lambda:stream.read(1024**2),b''):h.update(block)
        if h.hexdigest()!=row['sha256']:raise ValueError('Hash mismatch: '+name)
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p!=root/'pack-files.json'}
    if actual!=seen:raise ValueError('Unlisted package file')
    print(json.dumps({'files_verified':len(seen),'physics_tested':False}))
    return True


if __name__=='__main__':
    try:verify(Path(__file__).parent)
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
