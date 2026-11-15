"""Render a new self-contained synthetic Fleet Learning evaluation MP4 and proof."""
from __future__ import annotations
import argparse
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess
import sys
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from robotics.world_worker.fleet_campaign import sample_fixture

W,H=1280,720
BG=(6,12,25);PANEL=(18,31,49);TEXT=(235,243,255);MUTED=(147,172,197)
CYAN=(83,220,232);VIOLET=(185,137,250);GREEN=(96,229,171);RED=(245,127,139);ORANGE=(244,193,110)
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def font(n,b=False):return ImageFont.truetype(BOLD if b else FONT,n)
F12=font(12);F14=font(14);F17=font(17);F19=font(19);F24=font(24,True);F32=font(32,True);F42=font(42,True);F64=font(64,True)

def rect(d,coords,fill,r=12,outline=None,width=1):d.rounded_rectangle(coords,radius=r,fill=fill,outline=outline,width=width)
def text(d,x,y,t,f=F17,color=TEXT):d.text((x,y),str(t),fill=color,font=f)

def draw_map(d,rows,paths,show_reference=False,focus=None):
    x0,y0,s=54,174,20
    for y,row in enumerate(rows):
        for x,c in enumerate(row):
            x1=x0+x*s;y1=y0+y*s
            fill=(27,42,62) if c=='.' else (66,77,94) if c=='#' else (68,52,78)
            d.rectangle((x1,y1,x1+s-1,y1+s-1),fill=fill)
    if show_reference:
        x,y=x0+8*s+10,y0+11*s+10
        d.rectangle((x-12,y-12,x+12,y+12),outline=RED,width=4)
    for path,color,fraction in paths:
        n=max(2,1+int((len(path)-1)*max(0,min(1,fraction))))
        coords=[(x0+(x+.5)*s,y0+(y+.5)*s) for x,y in path[:n]]
        if len(coords)>1:d.line(coords,fill=color,width=5,joint='curve')
        if coords:d.ellipse((coords[-1][0]-7,coords[-1][1]-7,coords[-1][0]+7,coords[-1][1]+7),fill=color)
    if focus:
        x,y=focus;cx=x0+(x+.5)*s;cy=y0+(y+.5)*s
        d.ellipse((cx-16,cy-16,cx+16,cy+16),outline=ORANGE,width=3)


def frame(t,report,rows,teacher_path,case):
    image=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(image)
    for yy in range(0,H,35):
        for xx in range(0,W,35):d.point((xx,yy),fill=(23,34,53))
    d.rectangle((0,0,1280,5),fill=CYAN)
    text(d,38,24,'◈  BrainSNN',F32)
    text(d,38,69,'WORLD BUILDER   /   FLEET EXPERIENCE EVALUATION',F14,CYAN)
    text(d,39,106,'CAN OTHER ROBOTS LEARN FROM ONE ROUTE?',F32)
    rect(d,(985,31,1242,67),(28,44,63),11,outline=(61,98,114),width=2)
    text(d,1002,42,'AUTHORED SYNTHETIC DEMO',F12,CYAN)
    rect(d,(34,160,637,592),PANEL,17,outline=(45,69,89),width=2)
    phase=0 if t<4 else 1 if t<10 else 2 if t<17 else 3 if t<22 else 4
    selected=case['id']
    paths=[]
    if phase==0:paths=[(teacher_path,CYAN,min(1,max(0,(t-1)/3)))]
    if phase==1:paths=[(teacher_path,(77,136,146),1),(case['transfer']['path_cells'],VIOLET,min(1,(t-4)/5))]
    if phase>=2:paths=[(case['baseline']['path_cells'],CYAN,1),(case['transfer']['path_cells'],VIOLET,1)]
    draw_map(d,rows,paths,show_reference=(phase>=2),focus=(8,11) if phase>=2 else None)
    text(d,55,553,'26 × 18 authored map  |  0.4 m/cell',F14,MUTED)
    text(d,55,573,'Red marker: obstacle withheld from candidate map',F12,RED if phase>=2 else MUTED)
    rect(d,(655,160,1245,592),PANEL,17,outline=(45,69,89),width=2)
    text(d,681,185,['01 / RECORD REVIEWED SUCCESS','02 / TRANSFER AND RETARGET','03 / TEST 24 HELD-OUT STARTS','04 / NEGATIVE RESULTS MATTER','05 / PHYSICAL VALIDATION GATES'][phase],F19,CYAN)
    d.line((682,228,1215,228),fill=(52,75,97),width=2)
    if phase==0:
        text(d,683,267,'Robot A: route reconstructed from',F24)
        text(d,683,305,'authored map-cell positions.',F24)
        text(d,683,362,'Log format: timestamp / x / y / yaw',F17,MUTED)
        text(d,683,395,'Frame: ROS map, metres and radians',F17,MUTED)
        text(d,683,429,'Episode: reviewed success',F17,GREEN)
        text(d,683,464,'Exact map and CSV SHA-256 required',F17,ORANGE)
    elif phase==1:
        text(d,683,267,'Robot B has a wider footprint.',F24)
        text(d,683,312,'Experience hints at the corridor.',F19,MUTED)
        text(d,683,354,'The route must be replanned.',F19)
        text(d,683,409,'No motor/joint command is copied.',F19,ORANGE)
        text(d,683,461,'No ML weights were updated.',F19,MUTED)
    elif phase==2:
        text(d,681,247,'Same task, 24 unseen start positions',F19,MUTED)
        for i,c in enumerate(report['cases']):
            x=691+(i%8)*64;y=302+(i//8)*75
            base=c['baseline']['reference_clear'];transfer=c['transfer']['reference_clear']
            rect(d,(x,y,x+50,y+50),(28,65,59) if transfer else (78,42,55),9)
            text(d,x+11,y+5,f'{i+1:02d}',F17)
            d.rectangle((x+6,y+39,x+44,y+42),fill=GREEN if base else RED)
            d.rectangle((x+6,y+45,x+44,y+48),fill=VIOLET if transfer else RED)
        text(d,690,540,'Bars: baseline / experience, static reference-clear',F12,MUTED)
    elif phase==3:
        text(d,681,263,'GOAL-ONLY BASELINE',F14,MUTED)
        text(d,681,290,'21 / 24',F64,CYAN)
        text(d,681,392,'EXPERIENCE-GUIDED',F14,MUTED)
        text(d,681,417,'17 / 24',F64,VIOLET)
        text(d,681,515,'Transfer did worse. No route-length gain.',F17,RED)
    else:
        text(d,681,264,'Use the failed cases to improve:',F24)
        for i,s in enumerate(['Independent measured reference maps','Sensor-verified obstacle coverage','Robot-specific offline evaluation','Supervised physical trials with E-stop']):
            text(d,688,325+i*46,'✓  '+s,F17,GREEN if i==0 else MUTED)
        text(d,689,529,'DEPLOYMENT GATE: CLOSED',F17,ORANGE)
    rect(d,(34,606,1245,694),(22,37,56),12,outline=(37,63,83))
    if phase<3:
        text(d,60,625,'NOT REAL ROBOT FOOTAGE',F19,ORANGE)
        text(d,60,661,'Source map: camera-style authored grid  |  independent reference: synthetic obstacle',F14,MUTED)
    else:
        text(d,60,625,'RESULT: a useful failure, not proof of learned skill',F19,ORANGE)
        text(d,60,661,'No survey claim  |  No physics simulation  |  No deployed robot  |  No learned policy',F14,MUTED)
    d.rectangle((0,715,int((t/26)*1280),719),fill=VIOLET)
    return image


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--fixture',required=True,type=Path);ap.add_argument('--out',required=True,type=Path)
    ap.add_argument('--fps',type=int,default=10);ap.add_argument('--duration',type=int,default=26)
    a=ap.parse_args()
    report=json.loads((a.fixture/'fleet-campaign-report.json').read_text())
    manifest=json.loads((a.fixture/'candidate-map/nav2-map.json').read_text())
    w=manifest['grid']['width'];raw=(a.fixture/'candidate-map/nav2-map.pgm').read_bytes();header=f'P5\n{w} {manifest["grid"]["height"]}\n255\n'.encode();px=raw[len(header):]
    decode={0:'#',205:'?',254:'.'};rows=[''.join(decode[v] for v in px[y*w:(y+1)*w]) for y in range(manifest['grid']['height'])]
    sample=report['cases'][6];teacher_path=json.loads((a.fixture/'fleet-campaign-report.json').read_text())['cases'][0]['baseline']['path_cells']
    # For this synthetic video, teacher line is reconstructed from the exact source movement CSV.
    from robotics.world_worker.fleet_nav2 import load_nav2_map,import_reviewed_episode
    bound=load_nav2_map(a.fixture/'candidate-map');ep,_=import_reviewed_episode(bound,json.loads((a.fixture/'telemetry-manifest.json').read_text()),(a.fixture/'robot-poses.csv').read_bytes())
    teacher_path=[list(p) for p in ep.path]
    a.out.parent.mkdir(parents=True,exist_ok=True)
    import numpy as np
    import cv2
    temp=a.out.with_suffix('.working.mp4')
    writer=cv2.VideoWriter(str(temp),cv2.VideoWriter_fourcc(*'mp4v'),a.fps,(W,H))
    if not writer.isOpened():raise RuntimeError('mp4v encoder unavailable')
    try:
        for index in range(a.fps*a.duration):
            img=frame(index/a.fps,report,rows,teacher_path,sample)
            writer.write(cv2.cvtColor(np.asarray(img),cv2.COLOR_RGB2BGR))
    finally:writer.release()
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(temp),'-c:v','libx264','-preset','veryfast',
                    '-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',str(a.out)],check=True)
    temp.unlink()
    frame(19,report,rows,teacher_path,sample).save(a.out.with_suffix('.png'))
    evidence={'schema':'brainsnn.fleet-phase2-demo-receipt.v1','provenance':'authored-synthetic-video',
              'candidate_map_sha256':report['candidate_map_sha256'],'reference_map_sha256':report['reference_map_sha256'],
              'heldout_cases':24,'baseline_reference_clear':21,'transfer_reference_clear':17,
              'independent_metric_validation':False,'physical_robot_executed':False,'trained_policy':False,
              'video_sha256':sha256(a.out.read_bytes()).hexdigest()}
    a.out.with_suffix('.proof.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print('rendered',a.out,a.out.stat().st_size,'bytes')
if __name__=='__main__':main()
