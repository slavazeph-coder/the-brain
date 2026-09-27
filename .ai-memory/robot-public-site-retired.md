---
type: user
description: User moved robot sponsorship to XIO and asked to remove its public BrainSNN page
---
The public Robot 001 page belongs at https://www.xioai.ca/robot-sponsorship/. Remove the BrainSNN homepage navigation and footer links. BrainSNN public index, checkout and privacy page routes permanently redirect to their corresponding canonical www.xioai.ca paths. Only recognized placement/payment query values survive; never relay arbitrary tokens or user input in the redirect.

Keep /api/sponsors, the private SQLite database, owner admin UI, webhook and payment gates intact: the XIO form and checkout use that shared service. Do not delete sponsorship code or model files: XIO builds from an immutable approved source revision, and the archived standalone renderer/application tests remain useful. The production Express preload applies the public retirement middleware before the legacy/shared handler, unconditionally. No request header or query can disable retirement. The standalone local fixture is not a production route.

Do not change the separate GT3 campaign, other BrainSNN tools, XIO source, Stripe settings or DNS as part of this removal. Public live QA now checks the retirement and API continuity instead of expecting the discontinued BrainSNN studio to render. Bare-domain routing is reported separately from verified canonical www redirects.
