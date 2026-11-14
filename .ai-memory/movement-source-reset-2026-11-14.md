---
type: project
description: Cancel old acceleration reads on the common movement source-reset path
---

During private-worker sync PR #300 review identified that #capture-file could open a new video while an old acceleration CSV read remained pending. The receiver accepted any modelled trace while a video was current, so the old recording's support estimate could attach to the new video and its exports.

The website fix dispatches a common movement-source-reset event from clearSource, and the support module invalidates pending reads and clears mass/label/file/offset provenance there. This covers both file inputs, demos, trial demos and decode-error resets. A deterministic deferred-read test executes the production support module; the browser regression opens a replacement through #capture-file before releasing the old File.text promise and checks event delivery, cleared form, force label and exported null trace.

Apply this fix to main as well as the deployment branch before releasing the sync. It does not change the support formula or establish biomechanical accuracy. Preserve measured/modelled/synthetic distinctions.
