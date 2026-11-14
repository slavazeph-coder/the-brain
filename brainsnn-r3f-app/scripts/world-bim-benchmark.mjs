import {readFile,writeFile} from 'node:fs/promises';
import {sha256} from '../public/world/asbuilt-core.mjs';
import {scoreReference} from '../public/world/asbuilt-benchmark.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--scene','--reference','--output','--prior-ifc'].includes(args[i])||!args[i+1])throw Error('Use --scene scene.json --reference reference.json --output benchmark.json [--prior-ifc prior.ifc]');options[args[i]]=args[i+1];}
for(const key of ['--scene','--reference','--output'])if(!options[key])throw Error('Missing '+key);
const scene=await readFile(options['--scene']),reference=await readFile(options['--reference']);
if(scene.length>16*1024*1024||reference.length>1024*1024)throw Error('Input size limit exceeded.');
const report=scoreReference(JSON.parse(scene),await sha256(scene),JSON.parse(reference),await sha256(reference),{priorIfcSha256:options['--prior-ifc']?await sha256(await readFile(options['--prior-ifc'])):null});
await writeFile(options['--output'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({detection:report.detection,position:report.position,scope:report.scope}));
