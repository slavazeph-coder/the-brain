'use strict';

// Prices preserve the latest approved page draft. They are proposal prices,
// not historical winning bids or a representation of delivered campaigns.
const CATALOG = Object.freeze([
  {id:'chest', name:'Chest', label:'The signature placement', opening:750000, fixed:1000000, surface:'Front torso', description:'Lead with your brand in the centre of the conversation. A prominent front-facing placement for an approved chest graphic.', benefit:'Front-facing portraits and conversations', mesh:'torso_link', face:'front'},
  {id:'back', name:'Back', label:'Make an impression leaving', opening:500000, fixed:650000, surface:'Rear torso', description:'A rear-facing placement for your identity, a short message or an approved campaign call to action.', benefit:'Rear views and walking sequences', mesh:'torso_link', face:'back'},
  {id:'shoulders', name:'Shoulder pair', label:'A presence from both sides', opening:400000, fixed:480000, surface:'Left and right shoulders', description:'A paired placement on suitable shoulder surfaces. Final artwork keeps joints, sensors and ventilation clear.', benefit:'Side profiles and close conversations', mesh:'left_shoulder_roll_link', face:'front'},
  {id:'arm', name:'Arm panel', label:'A closer connection', opening:300000, fixed:350000, surface:'One arm, subject to approval', description:'A compact identity placement on one approved arm surface. Side and dimensions are confirmed in the campaign agreement.', benefit:'Detail shots and interaction content', mesh:'left_elbow_link', face:'front'},
  {id:'thigh', name:'Thigh panel', label:'Designed to move', opening:300000, fixed:350000, surface:'One thigh, subject to approval', description:'A mid-body placement for a distinctive logo. The preview is illustrative; available surface depends on the final hardware.', benefit:'Full-body images and event footage', mesh:'left_hip_yaw_link', face:'front'},
  {id:'shin', name:'Shin panel', label:'Small space. Distinct identity.', opening:250000, fixed:300000, surface:'One shin, subject to approval', description:'A lower-leg graphic for concise, legible branding. Artwork and installation are reviewed for safe operation.', benefit:'Full-length portraits and details', mesh:'left_knee_link', face:'front'},
  {id:'qr', name:'Campaign partner', label:'Turn curiosity into a next step', opening:400000, fixed:500000, surface:'Approved campaign touchpoint', description:'An agreed QR or digital call to action with a campaign landing page and measurement plan. No new body panel is implied.', benefit:'Scans, visits and consented inquiries', mesh:'torso_link', face:'back'},
  {id:'naming', name:'Naming partner', label:'Be part of Robot 001’s story', opening:2500000, fixed:3500000, surface:'Campaign naming association', description:'Naming association across the agreed Robot 001 campaign. It does not automatically include every physical placement or ownership of the robot.', benefit:'Agreed campaign identity and content', mesh:'torso_link', face:'front'}
]);

const TERMS = Object.freeze({
  version:'2026-09-19.1',
  currency:'cad',
  durationDays:90,
  robot:'001',
  state:'applications_open',
  stage:'Founding campaign',
  notice:'Applications are open for Robot 001’s founding campaign. Hardware acquisition, venue access, artwork, dates and deliverables must be confirmed in writing before payment. A submission is not a reservation or an auction win.',
  start:'The proposed 90-day term begins on the first activation date in the signed agreement, not on application or payment.',
  pricing:'All prices are in Canadian dollars for the proposed 90-day term, before applicable taxes. Offers and fixed-price requests require review.',
  preview:'The 3D model uses Unitree G1 reference geometry. Cosmetic graphics are visual concepts, not manufacturing instructions, an OEM endorsement or confirmation of hardware ownership.',
  future:'Robots 002–005 are planned expansion inventory. No procurement or deployment date is represented.',
  measurement:'Agree the activation schedule, content quantities, measurement definitions, attribution links and reporting cadence before payment. No audience size, impressions, sales, ROI or livestream audience is guaranteed.',
  contact:'info@xioai.ca'
});

function publicCatalog(reserved = []) {
  return {terms:TERMS, zones:CATALOG.map(z => ({...z,status:reserved.includes(z.id)?'under_agreement':'open'}))};
}
module.exports = {CATALOG, TERMS, publicCatalog};
