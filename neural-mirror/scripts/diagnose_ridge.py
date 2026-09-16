"""Diagnose the matmul overflow warnings emitted by fit_ridge on healthy input.

self_test.py feeds x ~ N(0,1) with 240x18 features, yet ridge.py reports
divide-by-zero / overflow / invalid-value inside matmul. On well-scaled input
those warnings should be impossible, s...[truncated]