'use strict';

function resolveCheckoutDestination(origin, returnSite) {
  if (returnSite === undefined) {
    return origin + '/sponsor/checkout/';
  }
  if (returnSite === 'xio') {
    return 'https://www.xioai.ca/robot-sponsorship/checkout/';
  }
  const e = new Error('Unsupported checkout destination.');
  e.status = 400;
  throw e;
}

module.exports = { resolveCheckoutDestination };
