"""Strict offline Nav2 map and reviewed ROS 2 pose CSV import for Fleet Learning.

No robotics network or execution interfaces. A CSV is an operator-supplied export,
not proof of a physical run. Unknown map space always blocks replay.
"""
from __future__ import annotations

from dataclasses import dataclass
import csv
from hashlib import sha256
from io import StringIO
import json
import math
from pathlib import Path
import re

from .fleet_learning import Episode, GridScene, Robot, validate_episode

HEX64 = re.compile(r'^[0-9a-f]{64}$')
CSV_COLUMNS = ('timestamp_ns','x_m','y_m','yaw_rad','linear_m_s','angular_rad_s','position_std_m','frame_id')
MAX_PGM_BYTES = 2_000_000
MAX_CSV_BYTES = 8_000_000
MAX_RECORDS = 40_000


def digest(raw: bytes) -> str:
    return sha256(raw).hexdigest()


def read_bound(path: Path, maximum: int) -> bytes:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError('Input must be a bounded regular file, not a symbolic link')
    return path.read_bytes()


def json_strict(raw: bytes):
    def pairs(items):
        out = {}
        for k,v in items:
            if k in out:
                raise ValueError('Duplicate JSON property: ' + k)
            out[k] = v
        return out
    def reject(value):
        raise ValueError('Nonfinite JSON value: ' + value)
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject)


def number(value, name, lower=-1e8, upper=1e8):
    if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value) or not lower <= value <= upper:
        raise ValueError(name + ' must be a bounded finite number')
    return float(value)


@dataclass(frozen=True)
class MapBundle:
    scene: GridScene
    # Top-left of the top image row; positive ROS y is upwards.
    top_left_m: tuple[float,float]
    revision_sha256: str
    pgm_sha256: str
    source_scene_sha256: str
    source_cloud_sha256: str | None
    basis: str
    frame_id: str = 'map'

    def cell_from_pose(self, x_m:float, y_m:float) -> tuple[int,int]:
        s = self.scene.cell_size_m
        col = math.floor((x_m-self.top_left_m[0])/s)
        row = math.floor((self.top_left_m[1]-y_m)/s)
        return col,row

    def centre(self,col:int,row:int) -> tuple[float,float]:
        s=self.scene.cell_size_m
        return (self.top_left_m[0]+(col+.5)*s,self.top_left_m[1]-(row+.5)*s)

    def aligned_with(self, other:'MapBundle') -> bool:
        return (self.scene.width == other.scene.width and self.scene.height == other.scene.height and
                abs(self.scene.cell_size_m - other.scene.cell_size_m)<1e-10 and
                all(abs(a-b)<1e-8 for a,b in zip(self.top_left_m,other.top_left_m)) and
                self.frame_id == other.frame_id)



def world_point_clear(bundle:MapBundle,x_m:float,y_m:float,radius_m:float) -> bool:
    """Continuous disc-vs-cell rectangles for a physical pose in the static map.

    This is a 2D geometric proxy only, not collision dynamics or a verified body.
    """
    if not all(math.isfinite(z) for z in (x_m,y_m,radius_m)) or radius_m<0:
        return False
    s=bundle.scene.cell_size_m
    left,top=bundle.top_left_m
    if min(x_m-left,left+bundle.scene.width*s-x_m,top-y_m,y_m-(top-bundle.scene.height*s))<radius_m:
        return False
    col,row=bundle.cell_from_pose(x_m,y_m)
    if not (0<=col<bundle.scene.width and 0<=row<bundle.scene.height):return False
    pad=math.ceil(radius_m/s)+2
    for r in range(max(0,row-pad),min(bundle.scene.height,row+pad+1)):
        for c in range(max(0,col-pad),min(bundle.scene.width,col+pad+1)):
            if bundle.scene.rows[r][c]=='.':continue
            cx0=left+c*s;cx1=cx0+s;cy1=top-r*s;cy0=cy1-s
            dx=max(cx0-x_m,0.,x_m-cx1);dy=max(cy0-y_m,0.,y_m-cy1)
            if math.hypot(dx,dy)<=radius_m:return False
    return True

def swept_disc_clear(bundle: MapBundle, start: tuple[float,float], end: tuple[float,float], radius_m:float) -> bool:
    """Exact static 2D swept-disc versus occupied/unknown cell rectangles.

    Checks the line segment continuously, rather than sampling a set of points
    that might miss an obstacle corner. This is not body kinematics, contact
    physics, localization validation or a physical motion-safety certificate.
    """
    ax,ay=start;bx,by=end
    if not all(math.isfinite(v) for v in (ax,ay,bx,by,radius_m)) or radius_m<0:
        return False
    if not world_point_clear(bundle,ax,ay,radius_m) or not world_point_clear(bundle,bx,by,radius_m):
        return False
    s=bundle.scene.cell_size_m
    left,top=bundle.top_left_m
    c0=max(0,math.floor((min(ax,bx)-radius_m-left)/s)-1)
    c1=min(bundle.scene.width-1,math.floor((max(ax,bx)+radius_m-left)/s)+1)
    r0=max(0,math.floor((top-max(ay,by)-radius_m)/s)-1)
    r1=min(bundle.scene.height-1,math.floor((top-min(ay,by)+radius_m)/s)+1)

    def point_segment_distance_sq(px,py,x0,y0,x1,y1):
        dx=x1-x0;dy=y1-y0;d=dx*dx+dy*dy
        t=max(0.,min(1.,((px-x0)*dx+(py-y0)*dy)/d)) if d else 0.
        return (px-(x0+t*dx))**2+(py-(y0+t*dy))**2

    def intersect_rect(xlo,ylo,xhi,yhi):
        # Liang-Barsky segment clipping, including touching an obstacle.
        dx=bx-ax;dy=by-ay
        near,far=0.,1.
        for p,q in ((-dx,ax-xlo),(dx,xhi-ax),(-dy,ay-ylo),(dy,yhi-ay)):
            if abs(p)<1e-15:
                if q<0:return False
                continue
            v=q/p
            if p<0:near=max(near,v)
            else:far=min(far,v)
            if near>far:return False
        return True

    for row in range(r0,r1+1):
        for col in range(c0,c1+1):
            if bundle.scene.rows[row][col]=='.':continue
            xlo=left+col*s;xhi=xlo+s;yhi=top-row*s;ylo=yhi-s
            if intersect_rect(xlo,ylo,xhi,yhi):return False
            d2=min(
                max(xlo-ax,0.,ax-xhi)**2+max(ylo-ay,0.,ay-yhi)**2,
                max(xlo-bx,0.,bx-xhi)**2+max(ylo-by,0.,by-yhi)**2,
                *(point_segment_distance_sq(x,y,ax,ay,bx,by)
                  for x in (xlo,xhi) for y in (ylo,yhi)),
            )
            if d2<=radius_m*radius_m:return False
    return True


def load_nav2_map(folder: Path) -> MapBundle:
    """Recheck byte-for-byte BrainSNN Nav2 export, not a generic PGM/YAML parser."""
    folder=Path(folder)
    raw_manifest=read_bound(folder/'nav2-map.json',300_000)
    manifest=json_strict(raw_manifest)
    if manifest.get('schema')!='brainsnn.nav2-map.v1' or manifest.get('frameId')!='map' or manifest.get('units')!='m':
        raise ValueError('Expected BrainSNN Nav2 map in the map frame, in metres')
    g=manifest['grid']; ncol,nrow=g['width'],g['height']
    if not all(type(v) is int and 1<=v<=4096 for v in (ncol,nrow)) or ncol*nrow>1_000_000:
        raise ValueError('Invalid map dimensions')
    s=number(g['resolution'],'map resolution',.01,1.)
    origin=g['origin']
    if (not isinstance(origin,list) or len(origin)!=3 or origin[2]!=0 or
        g['imageRowOrder']!='highest ROS y first' or g['mode']!='trinary' or
        g['pgmValues'] != {'occupied':0,'free':254,'unknown':205}):
        raise ValueError('Unsupported map frame/row order/trinary encoding')
    x0=number(origin[0],'origin x');y0=number(origin[1],'origin y')
    if manifest.get('validation',{}).get('physicalRobotValidated') is not False:
        raise ValueError('Map physical validation metadata is absent or inconsistent')
    pgm=read_bound(folder/'nav2-map.pgm',MAX_PGM_BYTES)
    yaml=read_bound(folder/'nav2-map.yaml',100_000)
    artifacts=manifest['artifacts']
    for name,raw in (('nav2-map.pgm',pgm),('nav2-map.yaml',yaml)):
        if artifacts[name]['sha256']!=digest(raw) or artifacts[name]['bytes']!=len(raw):
            raise ValueError('Map artifact checksum changed: '+name)
    header=f'P5\n{ncol} {nrow}\n255\n'.encode('ascii')
    if not pgm.startswith(header) or len(pgm)!=len(header)+ncol*nrow:
        raise ValueError('Map PGM not an exact BrainSNN P5 raster')
    pixels=pgm[len(header):]
    if set(pixels)-{0,205,254}:
        raise ValueError('Non-trinary pixels in static map')
    raster={0:'#',205:'?',254:'.'}
    rows=tuple(''.join(raster[v] for v in pixels[row*ncol:(row+1)*ncol]) for row in range(nrow))
    count=manifest.get('counts',{})
    if count.get('occupied')!=pixels.count(0) or count.get('unknown')!=pixels.count(205) or count.get('free')!=pixels.count(254):
        raise ValueError('Map pixel counts differ from source manifest')
    source=manifest['source']
    if not HEX64.fullmatch(source.get('sceneSha256','')):
        raise ValueError('Map source scene digest missing')
    cloud=source.get('cloudSha256')
    if cloud is not None and not HEX64.fullmatch(cloud):
        raise ValueError('Cloud hash malformed')
    return MapBundle(GridScene(rows,s,'BrainSNN-nav2-scan-derived'),(x0,y0+nrow*s),
                     digest(raw_manifest),digest(pgm),source['sceneSha256'],cloud,
                     str(manifest.get('scale',{}).get('source','unknown')))


def csv_pose_samples(raw:bytes):
    if len(raw)>MAX_CSV_BYTES:
        raise ValueError('CSV exceeds size limit')
    try: stream=StringIO(raw.decode('utf-8-sig'))
    except UnicodeError as error:raise ValueError('CSV must be UTF-8') from error
    reader=csv.DictReader(stream)
    if reader.fieldnames is None or tuple(reader.fieldnames)!=CSV_COLUMNS:
        raise ValueError('Expected exact ROS 2 pose CSV header: '+','.join(CSV_COLUMNS))
    result=[]
    for i,row in enumerate(reader):
        if i>=MAX_RECORDS:raise ValueError('Too many pose samples')
        if None in row:raise ValueError('CSV row has extra columns')
        try:
            ts=int(row['timestamp_ns'])
            if str(ts)!=row['timestamp_ns'] or ts<0:raise ValueError()
        except (ValueError,TypeError):raise ValueError('Invalid timestamp_ns')
        vals={k:float(row[k]) for k in CSV_COLUMNS[1:7]}
        if any(not math.isfinite(v) for v in vals.values()):raise ValueError('Nonfinite pose sample')
        if not -math.pi-1e-8<=vals['yaw_rad']<=math.pi+1e-8:raise ValueError('Yaw must be in radians [-pi, pi]')
        if vals['position_std_m']<0 or vals['position_std_m']>.25:raise ValueError('Excessive or invalid localization uncertainty')
        if not row['frame_id'] or len(row['frame_id'])>64:raise ValueError('Invalid frame_id')
        result.append({'timestamp_ns':ts,'frame_id':row['frame_id'],**vals})
    if len(result)<2:raise ValueError('At least two pose samples are required')
    return result


def import_reviewed_episode(map_bundle:MapBundle, manifest:dict, raw_csv:bytes):
    """Accept only exact-map, consented, reviewed 2D paths; never export raw video."""
    if manifest.get('schema')!='brainsnn.fleet-telemetry.v1':raise ValueError('Unsupported telemetry manifest')
    if manifest.get('map_revision_sha256')!=map_bundle.revision_sha256 or manifest.get('pgm_sha256')!=map_bundle.pgm_sha256:
        raise ValueError('Map revision changed after recording')
    if manifest.get('csv_sha256')!=digest(raw_csv):raise ValueError('Raw telemetry SHA-256 mismatch')
    if manifest.get('coordinate_convention')!='ROS-REP-103-ENU' or manifest.get('pose_frame_id')!='map':
        raise ValueError('Map-frame ENU pose required; transform odom with checked tf2 before export')
    if manifest.get('learning_consent') is not True or manifest.get('outcome')!='success' or manifest.get('reviewed') is not True:
        raise ValueError('Successful operator-reviewed and consented episode required')
    if manifest.get('source_type') not in ('authored-synthetic','operator-reported-recording'):
        raise ValueError('Source type missing')
    if not isinstance(manifest.get('task'),str) or not 1<=len(manifest['task'])<=80:
        raise ValueError('A bounded task label is required')
    profile=manifest.get('robot',{})
    robot=Robot(profile['id'],number(profile['radius_m'],'robot radius',.01,5.),
                number(profile['max_speed_m_s'],'maximum speed',.01,15.))
    samples=csv_pose_samples(raw_csv)
    if any(p['frame_id']!='map' for p in samples):raise ValueError('Telemetry frame changed or was not transformed to map')
    if samples[0]['timestamp_ns']>=samples[-1]['timestamp_ns']:
        raise ValueError('Non-increasing telemetry timestamps')
    points=[]; previous=None; previous_sample=None; inferred=0
    s=map_bundle.scene.cell_size_m
    for cur in samples:
        if previous_sample is not None:
            delta_ns=cur['timestamp_ns']-previous_sample['timestamp_ns']
            if not 0<delta_ns<=2_000_000_000:raise ValueError('Telemetry reversed or has a >2-second gap')
            dist=math.hypot(cur['x_m']-previous_sample['x_m'],cur['y_m']-previous_sample['y_m'])
            if dist/(delta_ns/1e9)>robot.max_speed_m_s*1.30+0.01:
                raise ValueError('Unphysical pose jump for configured robot speed')
            # Exact continuous swept disc against static occupied/unknown cells.
            if not swept_disc_clear(map_bundle,
                                    (previous_sample['x_m'],previous_sample['y_m']),
                                    (cur['x_m'],cur['y_m']),robot.footprint_radius_m):
                raise ValueError('Pose segment crosses blocked/unknown map cell or wall clearance')
        target=map_bundle.cell_from_pose(cur['x_m'],cur['y_m'])
        if not world_point_clear(map_bundle,cur['x_m'],cur['y_m'],robot.footprint_radius_m):
            raise ValueError('Source sample intersects blocked/unknown map cell or wall clearance')
        if previous is not None and previous!=target:
            # A unit diagonal or larger grid movement is not silently invented as direct controls.
            # Conservative cardinal interpolation checks every intermediate proxy cell.
            col,row=previous
            while (col,row)!=target:
                dx=target[0]-col;dy=target[1]-row
                candidates=([(col+int(math.copysign(1,dx)),row)] if dx else [])+\
                           ([(col,row+int(math.copysign(1,dy)))] if dy else [])
                valid=[q for q in candidates if map_bundle.scene.clear(*q,robot.footprint_radius_m)]
                if not valid:raise ValueError('No clearance-safe cardinal proxy for diagonal trajectory')
                # Prefer the axis with more remaining steps; reject any unsupported clearance.
                node=min(valid,key=lambda p:(abs(target[0]-p[0])+abs(target[1]-p[1]),p[1],p[0]))
                if node!=target:inferred+=1
                points.append(node);col,row=node
        elif previous is None:
            points.append(target)
        previous=target;previous_sample=cur
    # Reject stationary-only episodes and duplicated steps.
    if len(points)<2:raise ValueError('No movement in telemetry')
    ep=Episode('import-'+digest(raw_csv)[:16],map_bundle.scene.fingerprint,manifest['task'],robot,tuple(points),True,True,manifest['source_type'])
    validate_episode(map_bundle.scene,ep)
    receipt={'schema':'brainsnn.fleet-import-receipt.v1','source_type':manifest['source_type'],
             'source_sha256':digest(raw_csv),'map_revision_sha256':map_bundle.revision_sha256,
             'pgm_sha256':map_bundle.pgm_sha256,'source_scene_sha256':map_bundle.source_scene_sha256,
             'raw_sample_count':len(samples),'grid_path_cells':len(points),'inferred_cardinal_cells':inferred,
             'operator_reviewed':True,'learning_consent':True,'pose_frame':'map','pose_units':'m',
             'scale_basis':map_bundle.basis,'physical_robot_validated':False,
             'recording_authenticity_independently_verified':False,
             'camera_derived_geometry_survey_verified':False,
             'warnings':['Raw telemetry is operator-supplied; authenticity and localization are not independently validated.',
                         'Conservative grid proxies do not validate swept robot-body kinematics or safe motion.',
                         'Import does not export physical control commands.']}
    return ep,receipt
