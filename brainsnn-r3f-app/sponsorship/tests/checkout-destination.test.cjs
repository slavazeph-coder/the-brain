'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {resolveCheckoutDestination}=require('../checkout-destination.cjs');

test('resolveCheckoutDestination returns default origin path when returnSite undefined',()=>{
 assert.equal(resolveCheckoutDestination('https://www.brainsnn.com',undefined),'https://www.brainsnn.com/sponsor/checkout/');
 assert.equal(resolveCheckoutDestination('http://localhost:8091',undefined),'http://localhost:8091/sponsor/checkout/');
});

test('resolveCheckoutDestination returns literal XIO URL when returnSite is xio',()=>{
 assert.equal(resolveCheckoutDestination('https://www.brainsnn.com','xio'),'https://www.xioai.ca/robot-sponsorship/checkout/');
 assert.equal(resolveCheckoutDestination('http://localhost:8091','xio'),'https://www.xioai.ca/robot-sponsorship/checkout/');
});

test('resolveCheckoutDestination rejects unsupported returnSite values',()=>{
 assert.throws(()=>resolveCheckoutDestination('https://www.brainsnn.com','https://evil.example'),/Unsupported/);
 assert.throws(()=>resolveCheckoutDestination('https://www.brainsnn.com',null),/Unsupported/);
 assert.throws(()=>resolveCheckoutDestination('https://www.brainsnn.com',''),/Unsupported/);
 assert.throws(()=>resolveCheckoutDestination('https://www.brainsnn.com','other'),/Unsupported/);
});
