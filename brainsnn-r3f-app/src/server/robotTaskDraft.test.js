import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import express from 'express';
import {it} from '../test/tinyVitest.js';
import {SpendCeiling} from '../lib/rateLimit.js';
import {createWorldWorkerProxy} from './worldWorkerProxy.js';
import {createRobotTaskDraftService} from './robotTaskDraft.js';

const http = globalThis.fetch;
const DRAFT = '/api/world/robot-task-draft';
const PASSCODE = 'robot-draft-test-passcode';
const KEY = 'mock-provider-key';
const BRIEF = {consent:true, brief:'Move the slider to a marker 38 cm away.'};
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
const png = {mimeType:'image/png', data:pngHeader.toString('base64')};
const mov = {mimeType:'video/quicktime', data:Buffer.from('\0\0\0\x10ftypqt  \0\0\0\0').toString('base64')};

function reply(value, status = 200) {
  const response = status === 200 ? {
    status:'completed',
    steps:[{type:'thought'}, {type:'model_output',content:[{type:'text',text:JSON.stringify(value)}]}],
  } : value;
  return new Response(JSON.stringify(response), {status,headers:{'Content-Type':'application/json'}});
}

async function site({fetchImpl, limit = 10, apiKey = KEY, timeoutMs, maxConcurrent} = {}) {
  const processing = createWorldWorkerProxy({
    WORLD_WORKER_INTERNAL_URL:'http://127.0.0.1:1/',
    WORLD_SITE_PASSCODE:PASSCODE, WORLD_SITE_VISITORS:'1',
  });
  const ceiling = new SpendCeiling({limit, windowMs:3_600_000});
  const draft = createRobotTaskDraftService({
    authorize:processing.ownerSession, tryConsume:() => ceiling.tryConsume(), apiKey,
    fetchImpl, timeoutMs, maxConcurrent,
  });
  const app = express();
  app.post(DRAFT, draft.handle);
  app.use('/api/world', processing.handle);
  app.use(express.json({limit:32})); // Regression guard for early route placement.
  const server = createServer(app);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, token, headers = {}) {
    const response = await http(origin + path, {
      method:'POST', headers:{'Content-Type':'application/json',
        ...(token ? {Authorization:`Bearer ${token}`} : {}), ...headers},
      body:typeof body === 'string' ? body : JSON.stringify(body),
    });
    assert.equal(response.headers.get('cache-control'),'no-store');
    return {status:response.status,data:await response.json()};
  }
  async function session(body) {
    const opened = await post('/api/world/session',body);
    assert.equal(opened.status,201);
    return opened.data.token;
  }
  return {ceiling, post, session, close:async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }};
}

it('Gemini draft authorizes real owner sessions before parsing and makes one stateless v1 call', async () => {
  const calls = [];
  const web = await site({fetchImpl:async (url, options) => {
    calls.push({url, options, payload:JSON.parse(options.body)});
    return reply({task:'reach',distanceCm:38});
  }});
  try {
    const owner = await web.session({passcode:PASSCODE});
    const visitor = await web.session({});
    assert.equal((await web.post(DRAFT, '{broken', visitor)).status,401);
    assert.equal((await web.post(DRAFT, '{broken')).status,401);
    assert.equal((await web.post(DRAFT, '{broken', owner)).status,400);
    assert.equal((await web.post(DRAFT, {...BRIEF,consent:false}, owner)).status,400);
    assert.equal(calls.length,0);
    const result = await web.post(DRAFT, BRIEF, owner);
    assert.deepEqual(result,{status:200,data:{task:'reach',distanceCm:38}});
    assert.equal(calls.length,1);
    const {url, options, payload} = calls[0];
    assert.equal(url,'https://generativelanguage.googleapis.com/v1/interactions');
    assert.equal(options.headers['x-goog-api-key'],KEY);
    assert.equal(options.redirect,'error');
    assert.equal(payload.model,'gemini-4-hydrogen');
    assert.equal(payload.store,false);
    assert.equal(payload.response_format.mime_type,'application/json');
    assert.deepEqual(payload.generation_config,{max_output_tokens:1024,thinking_level:'low'});
    assert.equal(payload.tools,undefined);
    assert.deepEqual(JSON.parse(payload.input[0].text),{brief:BRIEF.brief});
    assert.equal(web.ceiling.remaining(),9);
  } finally { await web.close(); }
});

it('Gemini draft supports media-only input, bounds video sampling and rejects mismatched content before the model', async () => {
  const calls = [];
  const web = await site({fetchImpl:async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return reply({task:'unsupported',distanceCm:null});
  }});
  try {
    const owner = await web.session({passcode:PASSCODE});
    const send = (reference, brief = '') => web.post(DRAFT,{consent:true,brief,reference},owner);
    assert.equal((await send(undefined)).status,422);
    assert.equal((await send({mimeType:'image/webp',data:png.data})).status,422);
    assert.equal((await send({mimeType:'video/mp4',data:mov.data})).status,422);
    assert.equal((await send({...png,data:'data:image/png;base64,'+png.data})).status,422);
    const large = Buffer.alloc(2 * 1024 * 1024 + 1);
    pngHeader.copy(large);
    assert.equal((await send({...png,data:large.toString('base64')})).status,413);
    assert.equal(calls.length,0);
    assert.deepEqual(await send(png),{status:200,data:{task:'unsupported'}});
    assert.deepEqual(calls[0].input[1],{type:'image',mime_type:'image/png',data:png.data});
    assert.equal((await send(mov)).status,200);
    assert.deepEqual(calls[1].input[1],{type:'video',mime_type:'video/mov',data:mov.data,
      processing:{type:'static',start_offset:'0s',end_offset:'12s',fps:1}});
    for (const [mimeType, header] of [
      ['image/jpeg',Buffer.from([0xff,0xd8,0xff,0xe0])],
      ['image/webp',Buffer.from('RIFF\x08\0\0\0WEBPVP8 ')],
      ['video/mp4',Buffer.from('\0\0\0\x10ftypmp42\0\0\0\0')],
      ['video/webm',Buffer.from([0x1a,0x45,0xdf,0xa3,0x42,0x82,0x84,0x77,0x65,0x62,0x6d])],
    ]) {
      assert.equal((await send({mimeType,data:header.toString('base64')})).status,200);
      assert.equal(calls.at(-1).input[1].mime_type,mimeType);
    }
  } finally { await web.close(); }
});

it('Gemini draft fails closed on missing credentials, budget, provider error and invalid proposal', async () => {
  let calls = 0;
  const disabled = await site({apiKey:'',fetchImpl:async () => { calls++; }});
  try {
    const owner = await disabled.session({passcode:PASSCODE});
    assert.equal((await disabled.post(DRAFT,BRIEF,owner)).status,503);
    assert.equal(calls,0);
  } finally { await disabled.close(); }
  const web = await site({limit:4, fetchImpl:async () => {
    calls++;
    if (calls === 1) return reply({task:'push',distanceCm:100,explanation:'PRIVATE MODEL TEXT'});
    if (calls === 2) return reply({message:'SECRET PROVIDER ERROR'},500);
    if (calls === 3) return reply({message:'CLOUD QUOTA TEXT'},429);
    return new Response(' '.repeat(64*1024+1));
  }});
  try {
    const owner = await web.session({passcode:PASSCODE});
    for (const status of [503,503,429,503,429]) {
      const result = await web.post(DRAFT,BRIEF,owner);
      assert.equal(result.status,status);
      assert.deepEqual(Object.keys(result.data),['detail']);
      assert.doesNotMatch(result.data.detail,/PRIVATE|SECRET PROVIDER|CLOUD QUOTA/);
    }
    assert.equal(calls,4);
    assert.equal(web.ceiling.remaining(),0);
  } finally { await web.close(); }
});

it('Gemini draft times out a single in-flight request and aborts the provider', async () => {
  let calls = 0, aborted = false;
  const web = await site({timeoutMs:250,fetchImpl:async (_url, {signal}) => {
    calls++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      aborted = true;
      reject(signal.reason);
    }, {once:true}));
  }});
  try {
    const owner = await web.session({passcode:PASSCODE});
    assert.equal((await web.post(DRAFT,BRIEF,owner)).status,503);
    assert.equal(calls,1);
    assert.equal(aborted,true);
  } finally { await web.close(); }
});
