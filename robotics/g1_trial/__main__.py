"""Prepare and run a single G1 trial; never connects to robot hardware."""
import argparse
import json
from pathlib import Path
from .contracts import read_json


def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('preflight')
    q=sub.add_parser('prepare');q.add_argument('--pack',type=Path,required=True);q.add_argument('--spec',type=Path,required=True);q.add_argument('--out',type=Path,required=True)
    q=sub.add_parser('run');q.add_argument('--bundle',type=Path,required=True);q.add_argument('--upstream',type=Path,required=True);q.add_argument('--out',type=Path,required=True);q.add_argument('--video',action='store_true');q.add_argument('--wall-seconds',type=int,default=600)
    q=sub.add_parser('download-pair');q.add_argument('--out',type=Path,required=True);q.add_argument('--licenses-reviewed',action='store_true')
    a=p.parse_args()
    if a.command=='preflight':
        from .runtime import preflight
        result=preflight()
    elif a.command=='prepare':
        from .prepare import prepare
        result=prepare(a.pack,a.spec,a.out)
    elif a.command=='download-pair':
        from .policy import download_pair
        result=download_pair(a.out,a.licenses_reviewed)
    else:
        from .runtime import run
        result=run(a.bundle,a.upstream,a.out,a.video,a.wall_seconds)
    print(json.dumps(result,indent=2,allow_nan=False))
    return 2 if result.get('status') in ('blocked','failed','timed_out') else 0

if __name__=='__main__':
    raise SystemExit(main())
