"""BrainSNN fleet motion-transfer proof of concept: retrieval + safe grid replanning.

This module deliberately does NOT train a robot policy or command real hardware.
All distances are in the grid's authored metres. A verified metric scan or surveyed
reference is required before claiming physical geometry or clearance.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from heapq import heappush, heappop
from math import hypot, isfinite
import json
from typing import Sequence


@dataclass(frozen=True)
class GridScene:
    """Conservative 2D occupancy. `#` occupied, `?` unknown, `.` free."""
    rows: tuple[str, ...]
    cell_size_m: float
    evidence: str = 'authored-synthetic'

    def __post_init__(self):
        if not self.rows or not self.rows[0] or any(len(row) != len(self.rows[0]) for row in self.rows):
            raise ValueError('Occupancy rows must form a non-empty rectangle')
        if any(c not in '#?.' for row in self.rows for c in row):
            raise ValueError('Occupancy must contain only #, ?, .')
        if not isfinite(self.cell_size_m) or self.cell_size_m <= 0:
            raise ValueError('Cell size must be positive, finite metres')

    @property
    def width(self) -> int:
        return len(self.rows[0])

    @property
    def height(self) -> int:
        return len(self.rows)

    @property
    def fingerprint(self) -> str:
        raw = json.dumps([self.rows, self.cell_size_m, self.evidence], separators=(',',':'))
        return sha256(raw.encode()).hexdigest()

    def clear(self, col: int, row: int, radius_m: float) -> bool:
        """Minimum robot-centre to obstacle-cell rectangle exceeds footprint radius.

        A collision proxy check only. Dynamics, speed, localization and robot sensors
        are outside this method. Unknown cells count as obstacles.
        """
        if not 0 <= col < self.width or not 0 <= row < self.height:
            return False
        x, y, s = (col+.5)*self.cell_size_m, (row+.5)*self.cell_size_m, self.cell_size_m
        # The scan outside this rectangular grid must remain unknown.
        if min(x, y, self.width*s-x, self.height*s-y) < radius_m:
            return False
        pad = int(radius_m/s)+2
        for rr in range(max(0,row-pad), min(self.height,row+pad+1)):
            for cc in range(max(0,col-pad), min(self.width,col+pad+1)):
                if self.rows[rr][cc] == '.':
                    continue
                dx = max(cc*s-x, 0, x-(cc+1)*s)
                dy = max(rr*s-y, 0, y-(rr+1)*s)
                if hypot(dx,dy) <= radius_m:
                    return False
        return True


@dataclass(frozen=True)
class Robot:
    id: str
    footprint_radius_m: float
    max_speed_m_s: float

    def __post_init__(self):
        if not self.id or not all(isfinite(x) and x > 0 for x in (self.footprint_radius_m,self.max_speed_m_s)):
            raise ValueError('Robot must have positive finite radius/speed')


@dataclass(frozen=True)
class Episode:
    id: str
    scene_sha256: str
    task: str
    robot: Robot
    path: tuple[tuple[int,int], ...]
    succeeded: bool
    outcome_reviewed: bool
    provenance: str = 'authored-simulation'

    def __post_init__(self):
        if not self.id or not self.task or len(self.path) < 2:
            raise ValueError('Episode requires id/task/path')
        if not all(len(v)==2 and all(isinstance(a,int) and not isinstance(a,bool) for a in v) for v in self.path):
            raise ValueError('Path must contain integer grid coordinates')


def validate_episode(scene: GridScene, episode: Episode) -> None:
    if episode.scene_sha256 != scene.fingerprint:
        raise ValueError('Scene fingerprint mismatch')
    if not episode.succeeded or not episode.outcome_reviewed:
        raise ValueError('Only reviewed, successful episodes can teach another robot')
    for i, (col,row) in enumerate(episode.path):
        if not scene.clear(col,row, episode.robot.footprint_radius_m):
            raise ValueError(f'Source robot trajectory intersects blocked or unknown space at {i}')
        if i and abs(episode.path[i-1][0]-col)+abs(episode.path[i-1][1]-row) != 1:
            raise ValueError('Trajectory contains non-adjacent steps')


def retrieve(scene: GridScene, task: str, episodes: Sequence[Episode], goal: tuple[int,int]) -> Episode:
    """Nearest successful goal, same reviewed scene and task. Not FERT or VLA training."""
    valid = []
    for ep in episodes:
        if ep.task != task or ep.scene_sha256 != scene.fingerprint:
            continue
        try:
            validate_episode(scene,ep)
        except ValueError:
            continue
        valid.append(ep)
    if not valid:
        raise ValueError('No reviewed successful compatible episodes')
    return min(valid, key=lambda ep: (abs(ep.path[-1][0]-goal[0])+abs(ep.path[-1][1]-goal[1]),ep.id))


def plan_transfer(scene: GridScene, source: Episode, follower: Robot,
                  start: tuple[int,int], goal: tuple[int,int]) -> dict:
    """Adapt *intent/corridor* from successful movement via A*; do not copy controls.

    Transfer uses source path as a mild planning preference when possible. Unknown
    cells and footprint-inflated obstacles cannot be traversed. No robot command.
    """
    validate_episode(scene,source)
    if not scene.clear(*start,follower.footprint_radius_m) or not scene.clear(*goal,follower.footprint_radius_m):
        raise ValueError('Follower start or goal is not clearance-safe')
    # Explicitly measure distance to shared source experience rather than copying joints.
    source_cells = set(source.path)
    def source_distance(node):
        return min(abs(node[0]-p[0])+abs(node[1]-p[1]) for p in source_cells)
    def heur(node):return abs(node[0]-goal[0])+abs(node[1]-goal[1])
    queue=[(heur(start),0,start)]
    cost={start:0.0}
    parent={}
    serial=0
    while queue:
        _,_,node=heappop(queue)
        if node==goal:break
        for dx,dy in ((1,0),(0,-1),(0,1),(-1,0)):
            other=node[0]+dx,node[1]+dy
            if not scene.clear(*other,follower.footprint_radius_m):continue
            # Gentle preference for the observed corridor, never overrides clearance.
            step=1.0+0.04*min(source_distance(other),10)
            g=cost[node]+step
            if g>=cost.get(other,float('inf')):continue
            parent[other]=node
            cost[other]=g
            serial+=1
            heappush(queue,(g+heur(other),serial,other))
    if goal not in cost:
        raise ValueError('No footprint-safe simulated route for follower')
    route=[goal]
    while route[-1]!=start:
        route.append(parent[route[-1]])
    route.reverse()
    metres=(len(route)-1)*scene.cell_size_m
    # Counts changed *grid* cells, not pose or velocity imitation.
    return {
        'schema':'brainsnn.fleet-motion-transfer.demo.v1',
        'status':'simulation_plan_only',
        'source_episode_id':source.id,
        'source_robot_id':source.robot.id,
        'follower_robot_id':follower.id,
        'scene_sha256':scene.fingerprint,
        'source_provenance':source.provenance,
        'metric_basis':scene.evidence,
        'follower_radius_m':follower.footprint_radius_m,
        'path_cells':route,
        'distance_m':round(metres,3),
        'nominal_time_floor_s':round(metres/follower.max_speed_m_s,2),
        'independently_surveyed':False,
        'policy_finetuned':False,
        'physical_robot_validated':False,
        'limitations':['Authored collision grid, not a validated scan or physical environment.',
                       'No dynamic obstacles, SLAM localization, robot actuation or real transfer.',
                       'Episode retrieval and A* planning, not imitation learning or FERT reproduction.']}


def sample_scenario():
    """Authored room, narrow opening for the teacher, top detour for follower."""
    w,h=26,18
    cells=[['.' for _ in range(w)] for _ in range(h)]
    for x in range(w): cells[0][x]=cells[-1][x]='#'
    for y in range(h): cells[y][0]=cells[y][-1]='#'
    for y in range(5,15):
        if y not in (9,10):
            for x in (12,13):cells[y][x]='#'
    for x in range(18,21):
        for y in range(13,16):cells[y][x]='#'
    # Unknown region at lower right is never free.
    for y in (15,16):
        for x in (22,23):cells[y][x]='?'
    scene=GridScene(tuple(''.join(r) for r in cells),0.4)
    teacher=Robot('Teacher A | compact',0.20,0.45)
    follower=Robot('Follower B | wide',0.54,0.35)
    # Place source through the narrow opening using A* on teacher's footprint.
    seed=Episode('seed',scene.fingerprint,'deliver to bay',teacher,((3,10),(4,10)),True,True)
    path=plan_transfer(scene,seed,teacher,(3,10),(22,10))['path_cells']
    source=Episode('episode-001',scene.fingerprint,'deliver to bay',teacher,tuple(map(tuple,path)),True,True)
    plan=plan_transfer(scene,source,follower,(3,10),(22,10))
    return scene,source,follower,plan


if __name__=='__main__':
    scene,source,robot,plan=sample_scenario()
    print(json.dumps({'scene':{'rows':scene.rows,'cell_size_m':scene.cell_size_m,'evidence':scene.evidence,'fingerprint':scene.fingerprint},
                      'source':{'episode_id':source.id,'robot_id':source.robot.id,'path_cells':source.path},
                      'follower':{'id':robot.id,'radius_m':robot.footprint_radius_m},'transfer':plan},indent=2))
