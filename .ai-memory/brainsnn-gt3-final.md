# BrainSNN GT3 final build, September 2026

The car campaign lives at /sponsor/gt3/, not /lab (Neuro Powder) or /sponsor/ (robots). Preserve the homepage, product routes, robot reservations and payment flow. XIO remains the supporting operator identity. Do not migrate robot deposits or retail orders to the car campaign.

Load ./sponsorship/gt3/server.cjs before the other Express preloads in Railway, Docker and npm start. It only handles /sponsor/gt3 and /api/gt3. Its separate SQLite file uses GT3_DB_PATH or SPONSOR_DB_PATH plus .gt3 on the existing persistent volume. Owner access reuses SPONSOR_ADMIN_KEY; keys are never embedded, logged or persisted in the browser. The /sponsor/gt3/admin.html page reads private car proposals. There is no automatic proposal email delivery.

The car API accepts non-binding proposals only, with server validation, signed HttpOnly SameSite cookie, origin/CSRF checks, idempotency, private owner read/delete, and an approximately 180-day retention sweep. It has no checkout endpoint and never reserves inventory. Keep funds-raised claims and paid-bid labels out of this release. Pricing is the existing provisional cash model, not sponsor demand or accounting net income. The stronger target is C$1.344M pretax revenue using a C$500k car budget.

The user-supplied studio photo is explicitly illustrative. The exact Porsche model by Black Snow stays in the official attributed Sketchfab viewer. Model-ready comes from viewerready, never iframe load or a poster. Optional camera failures must not hide a ready car. Native-viewer fallback is not claimed as verified scene readiness. Consent is required before sending artwork to Sketchfab. No logo bytes accompany proposals.

Tests use disposable local storage and fixtures, never production proposals or payments. GT3 lab verification reports mocked interaction checks separately from an optional read-only real provider check. A successful deployment is not proof of iPhone graphics or third-party availability; inspect the provider report before making rendering claims. Existing sponsor-studio CI remains the broader startup/application gate. No Railway scaling or secret changes are part of this release.
