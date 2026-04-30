# Quantum Alignment Test Report

- Backend: `aer-ideal`
- Mode: `ideal`
- Shots per circuit: 4096

## What this report tests

This suite probes three *physical* properties of quantum computation: phase coherence and interference, the effect of measurement on a superposition, and the accumulation of gate noise / decoherence as circuit depth grows. "Multiverse alignment" is used here as a metaphor for the coherent phase relationships that produce interference -- it is **not** a literal claim about parallel universes, and nothing here can prove or disprove the many-worlds interpretation.

## Experiment 1 -- Phase alignment / interference

Circuit: `|0> - H - RZ(theta) - H - Measure`. The first H spreads |0> into an equal superposition; RZ(theta) puts a relative phase between the two branches; the second H lets those branches interfere. The ideal outcome is `p(0) = cos^2(theta/2)`.

| theta | p(0) measured | p(1) measured | p(0) ideal | |error| |
|---|---|---|---|---|
| 0 | 1.000 | 0.000 | 1.000 | 0.000 |
| pi/8 | 0.960 | 0.040 | 0.962 | 0.002 |
| pi/4 | 0.857 | 0.143 | 0.854 | 0.004 |
| pi/2 | 0.500 | 0.500 | 0.500 | 0.000 |
| 3pi/4 | 0.136 | 0.864 | 0.146 | 0.010 |
| pi | 0.000 | 1.000 | 0.000 | 0.000 |

Maximum deviation from the ideal interference pattern: **0.010**. On the ideal simulator this should be at the level of shot noise (~1/sqrt(shots) ~= 0.016). On a noisy or real backend it grows because gate errors and readout errors smear the interference fringes.

## Experiment 2 -- Observation collapse

Two circuits are compared. **A** applies H then H with no measurement in between: H is its own inverse, so the qubit returns to |0> and we expect `p(0) = 1`. **B** measures *between* the two H gates. That mid-circuit measurement collapses the superposition to a definite |0> or |1>; the second H then turns whichever basis state we have into a fresh equal superposition, so the final readout is ~50/50. If A is near 1.0 and B is near 0.5, observation has demonstrably destroyed interference.

| variant | p(0) | p(1) | expected p(0) | |error| | notes |
|---|---|---|---|---|---|
| A_no_mid_measure | 1.000 | 0.000 | 1.000 | 0.000 | H then H -> identity, expect p(0)=1 |
| B_mid_measure | 0.485 | 0.515 | 0.500 | 0.015 | Mid-circuit measurement collapses the state; expect ~50/50 |

## Experiment 3 -- Decoherence / noise accumulation

Circuit: `|0> - H - (X X)^n - H - Measure`. Each `X X` pair is the identity, so the ideal outcome is always `p(0) = 1` regardless of n. Any drift toward `p(0) = 0.5` as n grows is *purely* gate noise and decoherence (T1/T2 relaxation, control errors, readout errors). On the ideal simulator the line should stay flat at 1.0; on a noisy or real backend it will sag toward 0.5.

| X-X pairs | p(0) | p(1) | error = 1-p(0) |
|---|---|---|---|
| 0 | 1.000 | 0.000 | 0.000 |
| 1 | 1.000 | 0.000 | 0.000 |
| 2 | 1.000 | 0.000 | 0.000 |
| 4 | 1.000 | 0.000 | 0.000 |
| 8 | 1.000 | 0.000 | 0.000 |
| 16 | 1.000 | 0.000 | 0.000 |
| 32 | 1.000 | 0.000 | 0.000 |
| 64 | 1.000 | 0.000 | 0.000 |

At depth 64 X-X pairs, p(0) is **1.000** vs the ideal **1.0** (error **0.000**). The further this number is from 1.0, the more decoherence the device has accumulated over the run.

## Experiment 4 -- Bell-pair correlation sweep

Two qubits prepared as `|00> -> H ⊗ I -> CNOT(0,1)` form the maximally entangled Bell state |Φ+⟩ = (|00> + |11>) / √2. An additional RY(theta) on qubit 0 rotates the joint distribution; the signed correlation E(theta) = (P00+P11) - (P01+P10) traces the closed-form ideal `cos(theta)`. This is the L102 browser-native panel's hardware-grade sibling.

| theta | correlation measured | ideal cos(theta) | |error| | notes |
|---|---|---|---|---|
| 0 | 1.000 | 1.000 | 0.000 | entanglement is statistical correlation, not signaling |
| pi/4 | 0.705 | 0.707 | 0.003 | entanglement is statistical correlation, not signaling |
| pi/2 | 0.038 | 0.000 | 0.038 | entanglement is statistical correlation, not signaling |
| 3pi/4 | -0.731 | -0.707 | 0.024 | entanglement is statistical correlation, not signaling |
| pi | -1.000 | -1.000 | 0.000 | entanglement is statistical correlation, not signaling |

## What this is NOT

- Not a test of literal parallel universes or the many-worlds interpretation. Quantum mechanics is interpretation-agnostic and no single-qubit experiment can settle that debate.
- Not a benchmark of any specific IBM device. We use a tiny number of circuits at modest shot counts; published quantum-volume / EPLG numbers are far more rigorous.
- Not a security or randomness test. Do not use these counts as a source of cryptographic entropy.

## What this IS

- A reproducible demonstration that quantum amplitudes have phase, that phases interfere, that observation destroys interference, and that real hardware loses coherence as depth grows.
