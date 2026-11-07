// A photo placed in a reconstruction (the worker's locate-photo result), on the map proposed from that same
// reconstruction: where it was taken, which way it looked, and which floor spot a tap on it points at.
import {toMap} from './reconstruction-map.mjs';

/** Which proposal binding a map applied with these options keeps: an edit keeps the current one, a new proposal brings its
 *  own, and any other map (import, restore, sample, scene) has none, so a photo is never placed through another map's transform. */
export const proposalAfterApply=(current,{review=false,proposal}={})=>proposal!==undefined?proposal:review?current:null;

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const finite=v=>Array.isArray(v)&&v.length>=3&&v.slice(0,3).every(Number.isFinite);

/** The checked parts of a localization.json, or an error saying why it cannot be used. */
export function readLocalization(data){
  if(data?.schema!=='brainsnn.localization.v1')throw new Error('This is not a photo localisation result.');
  if(!data.located)return{located:false,reason:String(data.reason||'The photo was not placed.').slice(0,300)};
  const m=data.world_to_camera,c=data.camera;
  if(!finite(data.camera_center)||!Array.isArray(m)||m.length<3||!m.slice(0,3).every(finite)||!c||!Number.isFinite(c.width)||!Number.isFinite(c.height)||!Array.isArray(c.parameters))
    throw new Error('The localisation result is incomplete.');
  const p=c.parameters,[fx,fy,cx,cy]=c.model==='PINHOLE'?p:[p[0],p[0],p[1],p[2]];
  if(![fx,fy,cx,cy].every(Number.isFinite)||fx<=0||fy<=0)throw new Error('The localisation camera is invalid.');
  // Rows of the rotation are the camera axes in reconstruction coordinates: image right, image down, viewing direction.
  return{located:true,centre:data.camera_center.slice(0,3),right:m[0].slice(0,3),down:m[1].slice(0,3),forward:m[2].slice(0,3),
    width:c.width,height:c.height,fx,fy,cx,cy,inliers:data.inliers,correspondences:data.correspondences,
    reprojection:data.mean_reprojection_error_pixels,nearestFrame:data.nearest_frame};
}

/** Where the photo was taken on the map, and the direction it faced, in map metres. */
export function photoOnMap(photo,transform){
  const at=toMap(transform,photo.centre),dx=dot(photo.forward,transform.ex),dz=dot(photo.forward,transform.ez),len=Math.hypot(dx,dz);
  return{x:at.x,z:at.z,height:at.y,dx:len>1e-9?dx/len:0,dz:len>1e-9?dz/len:1};
}

/** The floor spot a tap at (u, v) photo pixels points at, in map metres; null above the horizon or off the map.
 *  Lens distortion is ignored: a tap is a few pixels wide anyway. */
export function floorFromTap(photo,transform,u,v,world){
  const x=(u-photo.cx)/photo.fx,y=(v-photo.cy)/photo.fy;
  const ray=[0,1,2].map(i=>photo.right[i]*x+photo.down[i]*y+photo.forward[i]);
  const rise=dot(ray,transform.up),height=dot(photo.centre,transform.up)-transform.floor;
  if(!(rise<-1e-9)||!(height>0))return null;  // the ray must go down from a camera above the floor
  const t=-height/rise,hit=[0,1,2].map(i=>photo.centre[i]+t*ray[i]),at=toMap(transform,hit);
  if(world&&(at.x<0||at.z<0||at.x>world.width||at.z>world.depth))return null;
  return{x:at.x,z:at.z};
}
