import {mountProjectReview} from './project-review-ui.mjs';

const review=mountProjectReview({host:document.getElementById('project-review-host')});
window.addEventListener('pagehide',event=>{
  if(event.persisted)review.cancel();
  else review.dispose();
});
