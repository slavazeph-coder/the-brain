---
type: project
description: GT3 direct checkout, frosted menus and illustrated proposed use cases
---

The user wants choose space > upload logo > pay, with no review/contact popup.
The new page uses direct.js/direct.css alongside the existing first-party Porsche
renderer and glass base styling. The visible space selector is an accessible
frosted listbox, backed by the native renderer's hidden #placement select. Three
bottom cards illustrate brand launches, AI/robotics demonstrations and campaign
content. Existing concept imagery is reused/cropped; no real client, venue,
performance result, endorsement or completed campaign is asserted.

POST /api/gt3/designs accepts intent pay only after genuine readiness and current
terms checks. It records no invented contact placeholders. Stripe collects the
payer email/name and canonical reconciliation persists those customer_details.
Prelaunch intent request asks for one email, without name/company. Legacy routes
remain compatible. Private artwork, inventory locks, raw webhook signatures,
authoritative prices and all existing payment gates are retained.

New tax.settings read still returned pending/head_office:null. No credentials,
tax registration, product activation, campaign terms or payment flags changed.
Do not describe the deployed UI as active payment collection. Existing campaign
approval and real sandbox validation are still required.

Backend tests inject mocked Stripe and real SQLite. Isolated browser tests use
real WebGL geometry and a clearly mocked hosted payment destination. Post-deploy
checks issue only GET/HEAD and never submit customer designs or charges. Local
layout fixtures are not proof of new 3D rendering or live acceptance.
