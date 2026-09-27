/* BrainSNN by XIO. Shared, dependency-free financial rules. */
(function(root){
'use strict';
const zones=Object.freeze([
{id:'hood',name:'Hood',tag:'The opening shot',weight:24},
{id:'driver-door',name:'Driver door',tag:'The hero placement',weight:18},
{id:'passenger-door',name:'Passenger door',tag:'A second first impression',weight:18},
{id:'wing',name:'Rear wing',tag:'The signature detail',weight:14},
{id:'driver-quarter',name:'Driver rear quarter',tag:'Made for the rolling shot',weight:9},
{id:'passenger-quarter',name:'Passenger rear quarter',tag:'Seen from the other side',weight:9},
{id:'driver-fender',name:'Driver front fender',tag:'Small, intentional, distinctive',weight:4},
{id:'passenger-fender',name:'Passenger front fender',tag:'The technical detail',weight:4}
]);
const defaults=Object.freeze({car:50000000,acquisition:6500000,operations:5000000,contingency:2500000,surplusFactor:1.3,feeRate:.035,salesTax:.13,fixedFee:30,transactions:8});
function economics(input={}){
const p={...defaults,...input};
for(const k of ['car','acquisition','operations','contingency','fixedFee','transactions'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>10000000000)throw new Error('Invalid '+k+' budget');
if(!p.car||!p.transactions)throw new Error('Vehicle budget and transaction count must be positive');
for(const [k,max]of [['surplusFactor',3],['feeRate',.15],['salesTax',.30]])if(!Number.isFinite(p[k])||p[k]<0||p[k]>max)throw new Error('Invalid '+k+' assumption');
const costs=p.car+p.acquisition+p.operations+p.contingency,requested=Math.ceil(p.car*p.surplusFactor);
const revenue=Math.ceil((costs+requested+p.fixedFee*p.transactions)/(1-p.feeRate*(1+p.salesTax))/100000)*100000;
const fees=Math.ceil(revenue*(1+p.salesTax)*p.feeRate)+p.fixedFee*p.transactions;
return {...p,costs,requested,revenue,fees,surplus:revenue-costs-fees,receipts:Math.ceil(revenue*(1+p.salesTax)),zones:zones.map(z=>({...z,reserve:Math.ceil(revenue*z.weight/100/25000)*25000}))};
}
const money=c=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(c/100);
root.GT3={zones,defaults,economics,money};
if(typeof module!=='undefined'&&module.exports)module.exports=root.GT3;
})(typeof globalThis!=='undefined'?globalThis:this);
