// A measured 8 x 6 m room, then the arbitrary frame COLMAP would report: rotated, scaled by K and shifted.
// Shared ground truth for the real -> sim proposal tests; no captured media is involved.
export const K=.37,SHIFT=[4,-2,7];
function rotation(ax,ay,az){const [ca,sa,cb,sb,cc,sc]=[Math.cos(ax),Math.sin(ax),Math.cos(ay),Math.sin(ay),Math.cos(az),Math.sin(az)];
  return [[cb*cc,sa*sb*cc-ca*sc,ca*sb*cc+sa*sc],[cb*sc,sa*sb*sc+ca*cc,ca*sb*sc-sa*cc],[-sb,sa*cb,ca*cb]];}
const R=rotation(.9,-.4,2.1);
const apply=(M,v)=>M.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
export const toColmap=p=>apply(R,p).map((v,i)=>v*K+SHIFT[i]);
export const BOX={x:[3,4],z:[2,3],h:.8},HIDDEN={x:[6.4,8],z:[5,6]};
export function room({tilt=0}={}){
  const pts=[];
  for(let x=.05;x<8;x+=.15)for(let z=.05;z<6;z+=.15){
    const hidden=x>HIDDEN.x[0]&&z>HIDDEN.z[0],inBox=x>BOX.x[0]&&x<BOX.x[1]&&z>BOX.z[0]&&z<BOX.z[1];
    if(!hidden&&!inBox)pts.push([x,0,z]);}
  for(let x=BOX.x[0];x<=BOX.x[1];x+=.1)for(let z=BOX.z[0];z<=BOX.z[1];z+=.1){pts.push([x,BOX.h,z]);for(let y=.15;y<BOX.h;y+=.15)if(x===BOX.x[0]||z===BOX.z[0])pts.push([x,y,z]);}
  for(let s=0;s<8;s+=.2)for(let y=.2;y<2.5;y+=.2){pts.push([s,y,0]);if(s<6.4)pts.push([s,y,6]);}
  for(let s=0;s<6;s+=.2)for(let y=.2;y<2.5;y+=.2){pts.push([0,y,s]);if(s<5)pts.push([8,y,s]);}
  // A walk around the box at chest height, phone upright and facing along the path.
  const path=[];for(let t=0;t<1;t+=.02){const a=t*Math.PI*2;path.push([4+2.4*Math.cos(a),1.35,2.8+1.7*Math.sin(a)]);}
  const cameras=path.map((c,i)=>{const n=path[(i+1)%path.length],f=[n[0]-c[0],Math.sin(tilt*i)*.05,n[2]-c[2]],l=Math.hypot(...f),fw=f.map(v=>v/l);
    const down=[0,-1,0],right=[fw[1]*down[2]-fw[2]*down[1],fw[2]*down[0]-fw[0]*down[2],fw[0]*down[1]-fw[1]*down[0]];
    const rows=[right,down,fw].map(r=>apply(R,r));
    return{image:`image_${String(i).padStart(4,'0')}.jpg`,camera_center:toColmap(c),world_to_camera:[[...rows[0],0],[...rows[1],0],[...rows[2],0]]};});
  return{points:pts.map(toColmap),reconstruction:{schema:'brainsnn.reconstruction.v1',cameras},truth:{pts,path}};
}
