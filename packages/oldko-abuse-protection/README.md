# @oldko/abuse-protection

Framework-agnostic server-side abuse-protection primitives for OldKOWeb services.

Includes opaque actor/IP/account key derivation, trusted-proxy-aware client IP resolution, fixed/sliding/token-bucket algorithms, a distributed-store contract, in-memory test adapter, fail-open/fail-closed behavior, observability hooks and reusable middleware.

The package intentionally does not modify Account API, Admin API, gateway or game-service implementations. Integrators select policies and adapters in their own services.

See `abuse-protection/ABUSE_PROTECTION_STANDARD.md` and `workstreams/ws48/INTEGRATION_PATCH.md`.
