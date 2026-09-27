'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {retirementDestination,retirePublicPage}=require('../public-retirement.cjs');
const XIO='https://www.xioai.ca/robot-sponsorship/';
test('old robot page URLs now resolve only to the XIO public campaign',()=>{
  for(const p of ['/sponsor','/sponsor/','/sponsor/index.html','/sponsor/%69ndex.html']) assert.equal(retirementDestination(p),XIO);
  assert.equal(retirementDestination('/sponsor/?placement=back&email=private@example.com&token=private&next=https://evil.example'),XIO+'?placement=back');
  for(const p of ['?placement=unknown','?placement=back&placement=chest','?next=https://evil.example','?placement=%0d%0aLocation:evil']) assert.equal(retirementDestination('/sponsor/'+p),XIO);
});
test('checkout and privacy redirects preserve safe return state, never private query tokens',()=>{
  for(const p of ['/sponsor/checkout','/sponsor/checkout/','/sponsor/checkout.html']){
    assert.equal(retirementDestination(p),XIO+'checkout/');
    assert.equal(retirementDestination(p+'?payment=returned&token=private'),XIO+'checkout/?payment=returned');
    assert.equal(retirementDestination(p+'?payment=cancelled'),XIO+'checkout/?payment=cancelled');
    assert.equal(retirementDestination(p+'?payment=paid'),XIO+'checkout/');
  }
  assert.equal(retirementDestination('/sponsor/privacy.html'),XIO+'privacy.html');
});
test('API, owner access, assets, GT3 and BrainSNN tools are not redirected',()=>{
  for(const p of ['/','/app','/engine','/healthz','/sponsor/admin','/sponsor/admin/','/sponsor/admin.html','/sponsor/admin.js','/sponsor/style.css','/sponsor/models/manifest.json','/sponsor/server.cjs','/sponsor/gt3/','/sponsor/gt3/index.html','/api/sponsors/status','/api/sponsors/catalog','/api/sponsors/purchase-options','/api/sponsors/applications','/api/sponsors/purchase','/api/sponsors/stripe/webhook','/api/sponsors/admin/applications','/sponsor/%']) assert.equal(retirementDestination(p),null,p);
});
test('retirement uses bodyless permanent redirects and never redirects a POST',()=>{
  for(const method of ['GET','HEAD']){
    let ended=false;const res={writeHead(code,headers){assert.equal(code,308);assert.equal(headers.Location,XIO);assert.equal(headers['Referrer-Policy'],'no-referrer');assert.equal(headers['Content-Length'],'0');},end(body){assert.equal(body,undefined);ended=true;}};
    retirePublicPage({method,url:'/sponsor/'},res,()=>assert.fail('Unexpected delegation'));assert.ok(ended);
  }
  let delegated=0;retirePublicPage({method:'POST',url:'/sponsor/'},{},()=>delegated++);retirePublicPage({method:'GET',url:'/api/sponsors/status'},{},()=>delegated++);assert.equal(delegated,2);
});
test('homepage no longer promotes robots and production startup installs retirement before the shared handler',()=>{
  const home=fs.readFileSync(path.resolve(__dirname,'../../src/app/BehaviourHome.jsx'),'utf8');
  assert.doesNotMatch(home,/Sponsor Robot|href=["']\/sponsor\//);
  const server=fs.readFileSync(path.resolve(__dirname,'../server.cjs'),'utf8');
  const registration=server.slice(server.indexOf('function register()'));
  assert.match(registration,/app\.use\(retirePublicPage\)/);
  assert.ok(registration.indexOf('app.use(retirePublicPage)')<registration.indexOf('appApi.matches(req)'));
});
