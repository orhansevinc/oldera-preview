# OldKO GM/Admin Command Bus

WS28 provides a server-side execution boundary between the Admin API (WS08) and game/moderation services. It is deliberately not a shell, RPC passthrough, database layer, or source of authorization truth.

## Security properties

- **Server-side allowlist only.** A command must exist in `createCommandRegistry()`. Unknown names are rejected with `COMMAND_NOT_ALLOWED`; there is no arbitrary dispatch by method name and no `exec`, shell, process, eval, or system-command facility.
- **Frontend is untrusted.** `admin/command-registry.json` was read only as a compatibility reference. Its names/risk labels do not grant permission and are not loaded dynamically at runtime.
- **Typed + runtime validated requests.** `index.d.ts` defines the public command union while `registry.js` validates each argument set and rejects extra keys.
- **Explicit actor identity.** Every request carries actor ID/type/roles/authentication method and optional session ID. The bus never constructs a privileged actor from frontend input.
- **Reason + request ID required.** Mutation requests require a human/operational reason and a stable request ID suitable for trace/audit correlation.
- **Authorization interface.** The caller must supply `authorizer.authorize(...)`; there is no permissive default. Authorization receives permission, risk, target, actor, reason and request metadata.
- **Audit fail-closed before side effects.** `command.accepted` must be persisted before the adapter runs. If the initial audit write fails, the command returns `AUDIT_UNAVAILABLE` and is not executed.
- **Idempotency.** The default in-memory store deduplicates concurrent and repeated requests by actor + request ID + command. Production can inject a durable/shared store implementing the same `run` contract.
- **Timeout + cancellation.** Adapters receive an `AbortSignal`; timeout produces a structured `TIMEOUT` result. Adapters must honor cancellation where the underlying service permits it.
- **Unavailable service handling.** Missing adapter methods and `ServiceUnavailableError` become `SERVICE_UNAVAILABLE`, never fallback behavior.
- **Dry-run is separate from execute.** A command supports dry-run only when it has an explicit preview handler. Dry-run never calls the mutating handler.

## Canonical allowlist

| Command | Permission | Risk | Dry-run | Adapter |
|---|---|---:|---:|---|
| `player.kick` | `gm.player.kick` | medium | yes | `gameOperations` |
| `player.teleport` | `gm.player.teleport` | medium | yes | `gameOperations` |
| `player.summon` | `gm.player.summon` | medium | yes | `gameOperations` |
| `account.ban` | `gm.account.ban` | high | yes | `moderation` |
| `account.unban` | `gm.account.unban` | high | yes | `moderation` |
| `chat.mute` | `gm.chat.mute` | medium | yes | `moderation` |
| `chat.unmute` | `gm.chat.unmute` | medium | yes | `moderation` |
| `notice.zone` | `gm.notice.zone` | low | no | `notices` |
| `notice.global` | `gm.notice.global` | low | no | `notices` |
| `server.player-count` | `gm.server.read` | low | no | `observability` |

Commands such as legacy `CLEAN`, `ATTACKDISABLE`, `ATTACKENABLE`, weather/time mutation, or any unspecified frontend command are intentionally **not** enabled by WS28. They require a future explicit server-side definition, permission, validator, audit classification, adapter contract and tests before use.

## Adapter boundary

WS28 does not modify game domains or the database. `gameOperations` is the boundary for kick/teleport/summon. `moderation` is the boundary for ban/unban/mute; the eventual implementation may call WS07/account services but WS28 does not perform SQL or migrations. `notices` and `observability` are likewise interfaces only.

## Result contract

Successful commands return `status: "ok"`, dry-runs return `status: "dry-run"`, and all expected failures return `status: "failed"`. Relevant codes include `COMMAND_NOT_ALLOWED`, `VALIDATION_ERROR`, `FORBIDDEN`, `AUTHORIZATION_UNAVAILABLE`, `AUDIT_UNAVAILABLE`, `DRY_RUN_UNSUPPORTED`, `TIMEOUT`, `SERVICE_UNAVAILABLE`, `EXECUTION_FAILED`, and `IDEMPOTENCY_UNAVAILABLE`.

The bundled `InMemoryIdempotencyStore` is process-local and intended for tests/single-instance development. A multi-instance deployment should inject a durable atomic idempotency store.
