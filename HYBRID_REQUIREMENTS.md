# Hybrid agent framework decision

User explicitly requests the best of CrewAI and kyegomez/swarms together, not replacement or two independent schedulers.

Proposed integration boundaries:
- BrainSNN durable job queue, owner auth, exclusive GPU leases, checkpoints and hardware quarantine remain the sole control plane.
- CrewAI adapter remains the bounded evidence-to-draft specialist pipeline.
- Swarms adapter provides bounded alternative-generation and independent critique/team patterns. Initial candidate is a fixed sequential or small fan-out workflow, NOT auto-generated unlimited teams.
- Frameworks exchange validated JSON artifacts through job records, never recursively invoke one another or independently allocate GPU resources.
- Final acceptance uses deterministic contracts plus human review where required; model consensus is not truth or payment evidence.
- Same local vLLM endpoint, no new paid provider or external tools by default. Video retains priority.
- Explicit limits: initial maximum three agents, one round, bounded token/time budgets; inference concurrency must respect existing GPU configuration.
- No external outreach, publication, spend or customer commitments without approval.

Release gate: isolated pinned Swarms install; real adapter test through loopback provider; contract/cancellation/timeout/network restriction tests; website engine selection and provenance; repeat local production/e2e tests before deployment. CrewAI + Swarms hybrid is NOT installed/deployed by this requirements update.
