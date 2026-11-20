# BrainSNN Project Review

Project Review turns one bounded, compiled building model and a project brief into two preliminary finish-scope options. It calculates quantities from the original model, applies the operator's reviewed rates, records questions and provides an explicit human decision step.

The first version supports **wall finishes and floor finishes only**. It does not change geometry, design new partitions, reconstruct hidden conditions, produce a complete construction estimate or approve a physical robot plan. Existing model, drawing, IFC, Rhino and route outputs retain their original content and validation status.

The exact request, calculation and export interfaces are in [the shared contract](world-project-review-contract.md).

## Open it

- In the main `/world/` workspace, choose **Review this project**. When a processed result containing `scene.json` is selected, the studio opens that result's original, integrity-checked scene bytes. The model viewer also provides the same review action.
- Open `/world/review.html` to use the standalone studio. Choose **Open scene.json** and supply an original BrainSNN compiler scene, or choose **Try example**.

The example is an explicitly authored room. Its geometry is defined in code, its source is labelled as an example, and its rate rows start blank and unreviewed. It is not a camera capture, measured building, live estimate or model-inference receipt.

The review source must use `brainsnn.scene.v1`, metres, and the existing stable component graph. The studio accepts up to 256 KiB of scene JSON and 128 components. It preserves the exact UTF-8 scene text for its source hash; equivalent JSON serialized into different bytes is a different review source. A point cloud or arbitrary JSON document is not a substitute for this compiler scene.

## Work through one project

1. **Open the original model.** Inspect the source label, the plan preview and the available components. The preview shows compiled geometry and selected scope; it does not establish measurement accuracy or complete surface coverage.
2. **Write the brief.** Enter a title, the goal, constraints, currency and an optional budget. Supported currencies are CAD, USD, EUR and GBP. No currency conversion is performed.
3. **Enter your rates.** The interface starts with standard and alternative wall/floor finish rows. Enter a low/high range per square metre, a source and a calendar date, then mark the rate as reviewed. Editing a rate clears its review checkbox. Zero is a valid explicit price; a blank or unreviewed rate remains unpriced.
4. **Choose the review mode.** Use **Compare locally** for fixed scope templates and calculations, or **Run AI team** for model-generated scope suggestions and critiques. The modes are labelled separately throughout the result and exports.
5. **Compare both options.** Review the selected components, quantities, source of each rate, assumptions, outstanding questions and budget comparison. A complete selected subtotal means that every listed line has a reviewed price; it does not mean that the entire project has been scoped or priced.
6. **Record a preliminary decision.** Select an option, enter the reviewer's name and an optional decision note, and acknowledge the preliminary scope. Approval is self-reported and retains all quantity and qualification limits.
7. **Download the work.** **Download proposal** saves a standalone readable HTML proposal. **Save review JSON** saves the normalized inputs, calculation report, any AI execution record and any human approval. A draft can be exported before approval and stays labelled as a draft.

The readable HTML includes the text brief and source-bound JSON receipt. The shared core also exposes a Markdown export for programmatic use. Exports do not include the original scene text; retain the original `scene.json` beside the review package. There is no saved-review import or cloud project store in this version. The review workspace, decision history and owner session are kept in the current tab, so download the files before leaving it.

Changing the source, brief or rates cancels any pending review and clears its result and approval. Selecting a different option or editing the reviewer's decision clears the previous approval. Late responses from an earlier input revision cannot replace the current work. Closing a review or leaving the page cancels the in-flight client request; this does not promise that an upstream provider has avoided all billing for work already started.

## Where quantities and amounts come from

The shared `public/world/project-review.mjs` module runs in both the browser and the server. The server prepares the original request independently; it does not accept client-computed quantities as authority.

- A wall finish quantity is one compiled wall face, using length × height, minus explicitly reviewed, valid hosted openings. Host identity, geometry, placement and non-overlap must agree with the current wall.
- A floor finish quantity comes from the compiler's `floor_observed` envelope. Renaming an unrelated object to “floor” does not make it a floor quantity. An envelope is not proof of complete room boundaries, floor coverage or usable area.
- A proposal may reference only existing components and compatible rate IDs. It cannot insert dimensions, geometry, amounts, approval fields or a third option.
- Each option contains at most 32 distinct component lines. There are at most 16 rate records in the shared contract; the current interface exposes four editable rows.
- A priced line uses its calculated quantity and reviewed low/high unit rates, rounded to cents. Missing or unreviewed rates produce null money fields. `knownSubtotal` includes only priced lines; `subtotal` remains null until every selected line is priced.
- Budget comparison uses that selected scope only. The tool does not add taxes, labour assumptions, waste, preparation, removals, access or disposal costs automatically. Capture missing work as explicit assumptions/questions and scope it separately.

The fixed validation fields remain `metricVerified:false`, `certified:false`, `physicalRobotValidated:false` and `finalQuotation:false`. Passing arithmetic or source-binding checks does not change them. Existing [dimensional evidence](world-dimension-checks.md) and [BIM review](world-bim-review.md) remain separate workflows.

## Local mode and AI mode

### Local comparison

Local mode uses fixed templates and deterministic calculations. One template refreshes the available wall faces, or the floor when no compatible wall rate exists. The other combines available wall and floor finishes, using the alternative rate rows when present. The user must compare these templates with the brief; the local mode does not claim to understand arbitrary project intent.

No model is called. Opening the page may request AI availability metadata, but that request contains no project and does not trigger inference.

### AI team

AI mode runs actual server-side provider calls through the existing Gemini client:

1. **Scope planner:** proposes exactly two alternatives using available component/rate references.
2. **Calculation tools:** validate the references and compute quantities and amounts in code.
3. **Estimator:** critiques the calculated options for missing scope, unreviewed rates, evidence gaps and conflicting assumptions.
4. **One optional revision:** if the estimator requests a revision, the planner revises once and the calculation tools run again.
5. **Reviewer:** reviews the final current options and calculations, including whether an earlier estimator concern was addressed.

The sequence uses three model calls normally and four when a planner revision is requested. The reviewer always runs last. Unresolved reviewer concerns remain for the person; they do not trigger another autonomous loop. Each completed step records its role, stage, timestamps, input hash, proposal hash and validated structured output. The interface shows returned execution history, not pre-scripted agent conversation.

The model cannot execute code, create design operators, mutate the original scene, alter calculated prices or approve an option. Its text is advisory. Multiple agents agreeing does not establish physical accuracy or completeness.

If the provider is unavailable, returns invalid JSON or fails a limit, the AI request reports that failure. It does not silently relabel a local calculation as an AI result. Local comparison remains a separately selectable mode.

## Owner access and data sent

AI requests require the existing World Builder **owner** session. The studio can reuse the main workspace's site session, or **Owner connection** can open a session with the existing processing passcode. Visitor sessions, worker tenant credentials and expired browser sessions do not authorize model calls. Credentials stay out of scene files, prompts, exports and browser persistence.

An AI run requires the operator's explicit consent to sending the source scene, brief and rates to BrainSNN. The browser sends the exact scene text, display label, brief, rate table and expected input hash to the site. The server verifies those inputs and sends Gemini a compact summary containing source identifiers, the brief, component names/IDs, supported tasks, calculated quantities and rates. Later specialist calls also receive the proposed options, calculated report and earlier critique.

This feature does not send source photos or video to the model. Existing reconstruction or observation uploads are separate flows with their own consent. Project labels, brief text, component details and commercial rates are still project data sent to the configured provider; local comparison keeps those inputs in the browser.

## Server configuration

The production wiring is in `brainsnn-r3f-app/server.ts`. The new endpoint is mounted before the general JSON parser and before the worker proxy. It uses `worldProcessing.ownerSession(req)` for authorization and the existing counted Gemini call helper with **zero automatic retries**.

| Setting | Behavior |
| --- | --- |
| `GEMINI_API_KEY` | Existing server-only provider credential. The AI team is unavailable when the Gemini client is not initialized. Do not put this key in a browser/Vite variable. |
| `WORLD_REVIEW_ENABLED` | `0` disables this feature's AI calls. Otherwise availability also requires the Gemini client and ready owner processing access. |
| `WORLD_REVIEW_MODEL` | First-choice model override for every specialist call. |
| `GEMINI_MODEL` | Existing fallback model setting when the review-specific override is absent. |
| Built-in model fallback | `gemini-3.5-flash`, matching the existing site's model choice. Configuration is not proof that the provider currently accepts that model. |
| `GEMINI_HOURLY_CEILING` | Existing process-wide model-call ceiling. Every review specialist call consumes this ceiling; `0` stops paid calls without deleting the credential. It is a call-count bound, not a currency budget. |
| Existing World Builder processing variables | Owner readiness and session creation still use the existing passcode/worker configuration. Follow [processing operations](brainsnn-processing-setup.md). The review itself does not create reconstruction jobs or require a GPU. |

The recorded provider is `google-gemini`. The recorded model is the configured model, with identity status `configured-provider-declaration`; it is not an independent audit of provider model weights.

Default service limits are:

| Limit | Value |
| --- | --- |
| Original scene JSON | 256 KiB |
| Raw HTTP request | 384 KiB, uncompressed JSON |
| Model context, including system instructions | 48 KiB per call |
| Model response | 32 KiB per call |
| Calculation/report document | 256 KiB |
| Exported JSON package | 512 KiB |
| Specialist calls | 3, or 4 with one revision |
| Output token request | 4,096 for the planner; 2,048 for either critic |
| Provider HTTP timeout | 30 seconds per call |
| Service deadline | 90 seconds for the whole run |
| Runs per owner session | 6 per hour |
| Runs across the process | 20 per hour |
| Concurrent reviews | 2 across the process; 1 per owner session |

The body budget accounts for escaped scene text, so a scene near its own limit can still exceed the request or context budget and be refused explicitly. Quotas reserve a run before the first provider call. Failure and cancellation do not refund a potentially paid run. A transport that ignores cancellation retains its provider slot until it settles, preventing cancelled requests from multiplying active provider work.

Sessions, counters and concurrency accounting are process-local. A restart resets them. These are not shared limits across replicas; qualify shared accounting before changing the existing single-process deployment assumption. Constructor overrides exist for controlled tests and integration, not as additional environment-variable settings.

### HTTP interface

- `GET /api/world/project-review` or `/status` returns configuration-only availability and limits. It does not establish provider health or physical qualification.
- `POST /api/world/project-review` or `/run` accepts the original request plus `consent:true` and the expected `inputSha256`, with `Authorization: Bearer <existing owner session>`.
- Success is `{report}`. The report includes independently calculated base fields and `execution`, `reviews` and `transcript` extensions.
- Failures return a bounded `detail`, a machine-readable `code` and `localAvailable:true`. Invalid references and extra model fields fail closed; no partial AI result is promoted as completed.

The server module accepts an injected `generate({role,system,prompt,signal,maxOutputTokens})` transport for testing. It must return JSON text or `{text,model}` and honor the abort signal. Tests use an explicit authored provider transport; production uses the server's Gemini client.

## Decisions, integrity and persistence

The input hash binds exact source bytes, the normalized source label, brief and rate table. The report validator recomputes the base quantities and prices, then validates any attached AI execution/critique/transcript structure and proposal digests. A human approval binds the input hash and the complete canonical report hash, including commentary. Modified source, scope, prices, commentary or execution history invalidates that approval.

The approval records a name and acknowledgement supplied by the operator. It is **self-reported**, not a verified identity, digital signature, permit approval or certification. Hashes detect inconsistent documents but are not signed attestations against someone rewriting an entire package. Draft and preliminary-approval labels remain explicit in the JSON and readable proposal.

No customer email is sent, no external document is published, and no source model or existing engineering export is rewritten by approval or download.

## Run the checks

Use the repository's installed/locked app dependencies. Commands below assume the repository root unless shown otherwise.

Focused shared-core checks:

```sh
node --test tests/world/project-review.test.mjs
```

World Builder contracts, including the new core and UI admission checks:

```sh
node --test tests/world/*.test.mjs
```

Application and server suite, including `src/server/projectReview.test.js` and the owner-session tests:

```sh
cd brainsnn-r3f-app
npm run test:run
npm run lint
npm run build
```

Browser acceptance from the repository root:

```sh
WORLD_BROWSERS=chromium,webkit node tests/world/project-review-browser-smoke.mjs
```

The browser command starts a loopback HTTP fixture and uses the actual owner-session handler, review service, page code, approval and downloads. The model transport returns **authored test responses**. It checks desktop and phone-sized layouts, local unpriced/priced results, consent and authentication, AI response admission, approval invalidation, safe HTML/JSON exports, cancellation and exact source-byte binding. It writes screenshots, downloads and its summary under `output/playwright/world/`.

The command requires installed Playwright browser binaries and an execution environment that permits those browsers to launch. `WORLD_BROWSERS` defaults to `chromium`; `PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_WEBKIT_PATH` can select an already provisioned compatible executable. A browser that cannot launch is a blocked browser check, not a passing result.

## Qualification status and next acceptance

The automated fixtures qualify software contracts and an authored test transport. They do not establish real-room geometry accuracy, complete quantities, commercially correct prices, useful live-model reasoning or a successful production release.

No live provider run is qualified by this implementation handoff. Before presenting this as a validated customer workflow:

1. Run the configured provider through the existing owner session using a permitted real project, retain the actual returned transcript and confirm its configured-model declaration.
2. Compare relevant wall/floor quantities with independently checked dimensions. Keep missing or failed checks visible.
3. Supply dated rates that the operator has reviewed for the actual scope; compare the proposal with a manual estimate, including exclusions and omitted work.
4. Measure total preparation and correction time against the existing process. Compare the team with a simpler tool-assisted workflow on the same cases.
5. Verify the merged commit's deployment, page assets, owner authentication and model behavior on the production service. A local test, green CI result or merged website commit alone does not establish provider execution or physical performance.

These are acceptance tasks, not achieved results or automatic promotion conditions. The feature remains a preliminary finish-scope review while those results are collected.
