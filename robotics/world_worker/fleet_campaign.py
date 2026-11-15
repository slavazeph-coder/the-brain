"""Offline Fleet Learning evaluation: 24 held-out tasks and static reference checks.

No trained policy, physics engine or live robot motion is represented. Distinguishes
model-map consistency from separately supplied reference-map clearance.
"""
from __future__ import annotations

import argparse
import csv
from hashlib import sha256
from heapq import heappush, heappop
from io import StringIO
import json
import math
from pathlib import Path

from .fleet_learning import Episode, GridScene, Robot, plan_transfer, sample_scenario, validate_episode
from .fleet_nav2 import MapBundle, digest, import_reviewed_episode, load_nav2_map, read_bound, world_point_clear


def goal_only_astar(scene:GridScene, robot:Robot, start:tuple[int,int], goal:tuple[int,int]):
    """A* baseline independent of fleet episode, same occupancy and robot footprint."""
    if not scene.clear(*start,robot.footprint_radius_m) or not scene.clear(*goal,robot.footprint_radius_m):
        raise ValueError('Start or goal blocked for target footprint')
    def h(node):return abs(node[0]-goal[0])+abs(node[1]-goal[1])
    queue=[(h(start),0,start)]
    best={start:0};parents={};counter=0
    while queue:
        _,_,node=heappop(queue)
        if node==goal:
            out=[goal]
            while out[-1]!=start:out.append(parents[out[-1]])
            out.reverse();return out
        for dx,dy in ((1,0),(0,-1),(0,1),(-1,0)):
            q=(node[0]+dx,node[1]+dy)
            if not scene.clear(*q,robot.footprint_radius_m):continue
            c=best[node]+1
            if c>=best.get(q,float('inf')):continue
            counter+=1;best[q]=c;parents[q]=node;heappush(queue,(c+h(q),counter,q))
    raise ValueError('No baseline route')


def reference_clearance(reference:MapBundle, path, robot:Robot):
    """Count static footprint collisions, not contact events from physical execution."""
    failed=[]
    for i,p in enumerate(path):
        x,y=reference.centre(*p)
        if not world_point_clear(reference,x,y,robot.footprint_radius_m):
            failed.append(list(p))
        if i:
            ax,ay=reference.centre(*path[i-1]); d=math.hypot(x-ax,y-ay)
            for j in range(1,max(2,math.ceil(d/(reference.scene.cell_size_m/6)))+1):
                t=j/max(2,math.ceil(d/(reference.scene.cell_size_m/6)))
                if not world_point_clear(reference,ax+(x-ax)*t,ay+(y-ay)*t,robot.footprint_radius_m):
                    if list(p) not in failed:failed.append(list(p))
                    break
    return {'reference_clear':not failed,'blocked_path_cells':failed[:20],
            'blocked_count':len(failed)}


def generate_heldout_starts(scene:GridScene,robot:Robot,source:Episode,count=24):
    if type(count) is not int or not 20<=count<=50:raise ValueError('Require 20..50 held-out tasks')
    goal=source.path[-1]
    candidates=[]
    for row in range(1,scene.height-1):
        for col in range(1,scene.width-1):
            p=(col,row)
            if p==goal or p in source.path or not scene.clear(*p,robot.footprint_radius_m):continue
            # Only use starts for which the independent baseline can find a route.
            try:goal_only_astar(scene,robot,p,goal)
            except ValueError:continue
            candidates.append(p)
    if len(candidates)<count:raise ValueError('Not enough physically plausible map starts for requested heldout task count')
    # Spread by deterministic index rather than cherry-picking the best transfers.
    ordered=sorted(candidates,key=lambda p:sha256(f'{scene.fingerprint}:{p}'.encode()).hexdigest())
    return ordered[:count]


def evaluate_campaign(candidate:MapBundle,reference:MapBundle,source:Episode,robot:Robot,count=24):
    validate_episode(candidate.scene,source)
    if not candidate.aligned_with(reference):raise ValueError('Reference grid is not in the same frame/origin/resolution')
    starts=generate_heldout_starts(candidate.scene,robot,source,count)
    goal=source.path[-1]
    records=[]
    for index,start in enumerate(starts):
        record={'id':f'heldout-{index+1:02d}','start':list(start),'goal':list(goal),
                'source_episode_id':source.id,'same_scene_as_source':True,'heldout_start':True}
        for name in ('baseline','transfer'):
            try:
                path=goal_only_astar(candidate.scene,robot,start,goal) if name=='baseline' else [tuple(p) for p in plan_transfer(candidate.scene,source,robot,start,goal)['path_cells']]
                ref=reference_clearance(reference,path,robot)
                record[name]={'status':'planned','cells':len(path),'route_m':round((len(path)-1)*candidate.scene.cell_size_m,3),
                              'path_cells':[list(p) for p in path],**ref}
            except ValueError as error:
                record[name]={'status':'unreachable','reason':str(error),'reference_clear':False,'blocked_count':None,
                              'route_m':None,'path_cells':[]}
        records.append(record)
    false_free=[]
    for row in range(candidate.scene.height):
        for col in range(candidate.scene.width):
            if candidate.scene.rows[row][col]=='.' and reference.scene.rows[row][col]!='.':
                false_free.append([col,row])
    total_free=sum(r.count('.') for r in candidate.scene.rows)
    def summary(key):
        planned=[c[key] for c in records if c[key]['status']=='planned']
        reference_safe=[p for p in planned if p['reference_clear']]
        return {'planned':len(planned),'reference_clear':len(reference_safe),
                'reference_blocked':len(planned)-len(reference_safe),
                'mean_planned_distance_m':round(sum(p['route_m'] for p in planned)/len(planned),3) if planned else None,
                'mean_reference_safe_distance_m':round(sum(p['route_m'] for p in reference_safe)/len(reference_safe),3) if reference_safe else None}
    baseline,transfer=summary('baseline'),summary('transfer')
    comparable=[c for c in records if c['baseline']['route_m'] is not None and c['transfer']['route_m'] is not None]
    delta=round(sum(c['transfer']['route_m']-c['baseline']['route_m'] for c in comparable)/len(comparable),3) if comparable else None
    is_synthetic=reference.basis.startswith('authored-') or reference.basis.startswith('synthetic-')
    return {'schema':'brainsnn.fleet-campaign.v1','status':'offline-static-grid-evaluation',
            'scope':'same-scene held-out starts, same destination; not cross-site, cross-task or learned-policy generalization',
            'candidate_map_sha256':candidate.revision_sha256,'reference_map_sha256':reference.revision_sha256,
            'candidate_source_scene_sha256':candidate.source_scene_sha256,
            'reference_basis':reference.basis,'reference_operator_attestation_only':not is_synthetic,
            'independent_survey_validation_performed_by_brainsnn':False,
            'scale_basis':candidate.basis,'source_episode_id':source.id,'source_provenance':source.provenance,
            'follower_robot_id':robot.id,'cases':records,
            'summary':{'heldout_case_count':len(records),'baseline':baseline,'transfer':transfer,
                       'mean_transfer_minus_baseline_m':delta,'false_free_cells':len(false_free),
                       'candidate_free_cells':total_free,'false_free_fraction':round(len(false_free)/total_free,6) if total_free else None,
                       'false_free_coordinates':false_free[:32]},
            'claims':{'camera_geometry_metric_accuracy_validated':False,'robot_simulator_physics_executed':False,
                      'real_robot_executed':False,'fleet_policy_trained':False,'independent_survey_verified':False},
            'warnings':['Baseline and transfer are both A* variants in an authored 2D occupancy map.',
                        'Reference checks are static collision proxies, not contact, swept-body or localization tests.',
                        'The reference map authenticity and coordinate alignment beyond its declared metadata are not independently checked.',
                        'Reference data, even if operator-reported measured, does not turn candidate phone geometry into surveyed accuracy.',
                        'Data sharing, policy training and physical robot commands are disabled.']}


def _write_nav2_fixture(folder:Path,scene:GridScene,source_tag:str,origin=(0.,0.)):
    """Exact BrainSNN P5 export-shape fixture, not a phone or physical scan."""
    folder.mkdir(parents=True,exist_ok=False)
    w,h=scene.width,scene.height
    pixels=bytes({'.':254,'?':205,'#':0}[c] for row in scene.rows for c in row)
    pgm=f'P5\n{w} {h}\n255\n'.encode()+pixels
    yaml=(f'image: nav2-map.pgm\nmode: trinary\nresolution: {scene.cell_size_m}\n'
          f'origin: [{origin[0]}, {origin[1]}, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n').encode()
    (folder/'nav2-map.pgm').write_bytes(pgm);(folder/'nav2-map.yaml').write_bytes(yaml)
    manifest={'schema':'brainsnn.nav2-map.v1','units':'m','frameId':'map',
              'grid':{'width':w,'height':h,'resolution':scene.cell_size_m,'origin':[origin[0],origin[1],0],
                      'imageRowOrder':'highest ROS y first','mode':'trinary','pgmValues':{'occupied':0,'free':254,'unknown':205}},
              'source':{'sceneSha256':digest(('AUTHORED:'+source_tag).encode()),'cloudSha256':None},
              'scale':{'source':'authored-synthetic-meters','selfReported':True,'verified':False},
              'counts':{'occupied':pixels.count(0),'unknown':pixels.count(205),'free':pixels.count(254)},
              'validation':{'physicalRobotValidated':False,'metricVerified':False},
              'artifacts':{'nav2-map.pgm':{'sha256':digest(pgm),'bytes':len(pgm)},
                           'nav2-map.yaml':{'sha256':digest(yaml),'bytes':len(yaml)}}}
    (folder/'nav2-map.json').write_text(json.dumps(manifest,indent=2,allow_nan=False)+'\n')


def sample_fixture(out:Path):
    """Generate an entirely authored, replayable 24-task campaign and import receipt."""
    out=Path(out)
    if out.exists():raise FileExistsError('Output must be new; never overwrite existing measurements')
    out.mkdir(parents=True)
    scene,source,follower,_=sample_scenario()
    _write_nav2_fixture(out/'candidate-map',scene,'candidate')
    # Reference includes a withheld obstacle not present in the candidate grid.
    reference_rows=list(scene.rows);row=list(reference_rows[11]);row[8]='#';reference_rows[11]=''.join(row)
    ref_scene=GridScene(tuple(reference_rows),scene.cell_size_m,scene.evidence)
    _write_nav2_fixture(out/'reference-map',ref_scene,'heldout-authored-reference')
    bound=load_nav2_map(out/'candidate-map')
    # Export a pose CSV in the correct ROS ENU frame, *not* a real hardware log.
    s=StringIO();writer=csv.writer(s);writer.writerow(('timestamp_ns','x_m','y_m','yaw_rad','linear_m_s','angular_rad_s','position_std_m','frame_id'))
    for i,(col,row) in enumerate(source.path):
        x,y=bound.centre(col,row);writer.writerow((i*1_000_000_000,f'{x:.3f}',f'{y:.3f}',0,.4,0,.02,'map'))
    csv_bytes=s.getvalue().encode();(out/'robot-poses.csv').write_bytes(csv_bytes)
    tm={'schema':'brainsnn.fleet-telemetry.v1','robot':{'id':source.robot.id,'radius_m':source.robot.footprint_radius_m,
                                                         'max_speed_m_s':source.robot.max_speed_m_s},
        'csv_sha256':digest(csv_bytes),'map_revision_sha256':bound.revision_sha256,'pgm_sha256':bound.pgm_sha256,
        'coordinate_convention':'ROS-REP-103-ENU','pose_frame_id':'map','task':source.task,'source_type':'authored-synthetic',
        'learning_consent':True,'outcome':'success','reviewed':True}
    (out/'telemetry-manifest.json').write_text(json.dumps(tm,indent=2)+'\n')
    ep,receipt=import_reviewed_episode(bound,tm,csv_bytes)
    report=evaluate_campaign(bound,load_nav2_map(out/'reference-map'),ep,follower,24)
    (out/'import-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    (out/'fleet-campaign-report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--sample',type=Path,help='Create a new authored sample directory with synthetic reports')
    parser.add_argument('--candidate-map',type=Path)
    parser.add_argument('--reference-map',type=Path)
    parser.add_argument('--poses-csv',type=Path)
    parser.add_argument('--telemetry-manifest',type=Path)
    parser.add_argument('--out',type=Path,help='New output directory; never overwrite previous experiment')
    parser.add_argument('--follower-profile',type=Path,help='Reviewed target robot profile JSON; required for imported logs')
    parser.add_argument('--task-count',type=int,default=24,help='20 to 50 held-out starts')
    args=parser.parse_args(argv)
    if args.sample:
        report=sample_fixture(args.sample)
    else:
        if not all((args.candidate_map,args.reference_map,args.poses_csv,args.telemetry_manifest,args.follower_profile,args.out)):
            parser.error('Provide all five real-data arguments or --sample')
        if args.out.exists():parser.error('Output directory must not already exist')
        candidate=load_nav2_map(args.candidate_map)
        reference=load_nav2_map(args.reference_map)
        tm=json.loads(read_bound(args.telemetry_manifest,100_000))
        ep,receipt=import_reviewed_episode(candidate,tm,read_bound(args.poses_csv,8_000_000))
        profile=json.loads(read_bound(args.follower_profile,100_000))
        if profile.get('schema')!='brainsnn.follower-profile.v1' or profile.get('reviewed') is not True:
            raise ValueError('Target robot profile must be operator-reviewed')
        margin=profile.get('safety_margin_m')
        if isinstance(margin,bool) or not isinstance(margin,(float,int)) or not math.isfinite(margin) or not 0<=margin<=2.:
            raise ValueError('Provide a finite, nonnegative safety margin')
        from .fleet_nav2 import number
        base_radius=number(profile['footprint_radius_m'],'follower footprint radius',.01,5.)
        follower=Robot(profile['robot_id'],base_radius+margin,
                       number(profile['max_speed_m_s'],'follower speed',.01,15.))
        report=evaluate_campaign(candidate,reference,ep,follower,args.task_count)
        report['follower_body']={'robot_id':follower.id,'operator_reviewed':True,
                                 'configured_footprint_radius_m':base_radius,
                                 'configured_safety_margin_m':margin,
                                 'offline_effective_clearance_radius_m':follower.footprint_radius_m,
                                 'physical_body_measured_or_validated_by_brainsnn':False}
        args.out.mkdir(parents=True)
        (args.out/'import-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        (args.out/'fleet-campaign-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':report['summary']['heldout_case_count'],
                      'baseline':report['summary']['baseline'],'transfer':report['summary']['transfer'],
                      'relative_distance_m':report['summary']['mean_transfer_minus_baseline_m'],
                      'reference_basis':report['reference_basis'],'scope':report['scope']},indent=2))

if __name__=='__main__':main()
