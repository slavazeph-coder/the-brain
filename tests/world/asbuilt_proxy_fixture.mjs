/** Actual site proxy on authored temporary data, no upstream transport stubs. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createWorldWorkerProxy} from '../../brainsnn-r3f-app/src/server/worldWorkerProxy.js';
const require=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url)),express=require('express'),app=express();
app.use('/api/world',createWorldWorkerProxy(process.env).handle);
app.get('/harness',(_req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BrainSNN | Authored worker review test</title><link rel="stylesheet" href="/world/world.css"><link rel="stylesheet" href="/world/asbuilt.css"></head><body><main class="asbuilt-page"><p class="eyebrow">AUTHORED SOFTWARE TEST / NO PHYSICAL ACCURACY CLAIM</p><h1>Review the capture.<br>Keep the original.</h1><div id="host"></div></main></body></html>'));
app.use('/fixture',express.static(process.env.ASBUILT_TEST_FIXTURE));
app.use(express.static(resolve('brainsnn-r3f-app/public')));
const server=app.listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
