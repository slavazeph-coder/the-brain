"""Trusted test adapter: authored compiler outputs, never a reconstruction claim."""
import argparse,json,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--fixture',type=Path,required=True);p.add_argument('--input-manifest',type=Path,required=True);a=p.parse_args()
r=json.loads(a.input_manifest.read_text());out=Path(r['output_dir']);job=out.parent
for src in (a.fixture/'reconstruction').rglob('*'):
 if src.is_file():
  target=job/src.relative_to(a.fixture/'reconstruction');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,target)
for name in ('scene.json','arena-cloud.json'):shutil.copyfile(a.fixture/'scene/output'/name,out/name)
(out/'manifest.json').write_text(json.dumps({'artifacts':[{'name':name,'kind':'evidence'} for name in ('scene.json','arena-cloud.json')]}))
