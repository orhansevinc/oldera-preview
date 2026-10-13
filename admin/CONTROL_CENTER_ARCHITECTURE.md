# OldERA Control Center Architecture

## Goal
The web Control Center and the in-game ROOT OWNER character must operate the same authoritative administration layer. No critical action should exist only in JavaScript, and the browser must never write directly to the game database.

## Surfaces
- `oldera.com` — public website
- `oldera.com/play` — browser game client
- `admin.oldera.com` — Control Center
- `forum.oldera.com` — future forum

## Shared administration path

```text
Control Center UI ─┐
                   ├─> Admin API / Command Bus ─> Game Server authority layer ─> DB / world state
In-game Owner UI ──┘
```

The Admin API is the only write surface for administrative actions. The game server remains authoritative.

## ROOT OWNER
`ORHAN` / ROOT OWNER is the highest authority profile.

Required guarantees:
1. Owner-only actions are not rendered for lower roles.
2. Every mutating action has actor, target, reason, source, timestamp and trace ID.
3. Critical server/world actions require re-authentication and confirmation.
4. Audit entries cannot be deleted by GM/Support roles.
5. Character/item mutations occur transactionally on the server side.

## Original 1298 GM command compatibility
The initial command registry mirrors the 1298 client command surface found in the Open-KO source:

- INVISIBLE
- CLEAN
- RAINING
- SNOWING
- TIME
- COUNT
- NOTICE
- ARREST
- FORBIDCONNECT
- FORBIDCHAT
- PERMITCHAT
- NOTICEALL
- CUTOFF
- VIEW
- UNVIEW
- FORBIDUSER
- SUMMONUSER
- ATTACKDISABLE
- ATTACKENABLE
- PROGRAMLISTCHECK

These command names are preserved as compatibility aliases. The actual server implementation may expose safer typed operations underneath them.

## Admin API contract

### Execute command
`POST /api/admin/commands`

```json
{
  "command": "SUMMONUSER",
  "target": "PlayerName",
  "arg": "",
  "reason": "Owner action",
  "source": "web-control-center"
}
```

Expected response:

```json
{
  "ok": true,
  "traceId": "ADM-...",
  "result": {}
}
```

### Dashboard
`GET /api/admin/overview`

Returns online count, nation/zone distribution, service health, registrations, character count and server uptime.

### Player lookup
`GET /api/admin/players/search?q=...&type=character|account|clan|ip|serial`

### Character detail
`GET /api/admin/characters/:name`

### Character mutation
`PATCH /api/admin/characters/:name`

Allowed typed mutations are validated by ROOT OWNER permissions and game-server rules.

### Inventory / bank
- `GET /api/admin/characters/:name/inventory`
- `GET /api/admin/characters/:name/inn`
- `GET /api/admin/items/:serial/history`

### Audit
`GET /api/admin/audit`

Append-only write happens internally; the browser has no delete endpoint.

## In-game Owner integration
The browser game client must identify the authenticated character authority returned by the server. When `authority=ROOT_OWNER`, the game UI can expose an Owner overlay / command palette. The overlay sends the same typed command payloads to the Admin API/command bus as the web Control Center.

Examples:
- Select player -> Summon
- Select player -> Arrest
- Select player -> Mute / Permit chat
- Owner stealth -> Invisible
- Global announcement -> Notice All
- World weather/time -> Rain / Snow / Time
- Server count -> Count

The in-game client does not receive direct DB credentials and cannot self-assign authority.

## Next implementation stages
1. Control Center visual shell and navigation — started.
2. Canonical GM command registry — started.
3. Authentication/session + ROOT OWNER role.
4. Read-only server/player/character API.
5. Command bus adapter to 1298-compatible game server.
6. Character/inventory/economy mutation services.
7. In-game Owner overlay using the same services.
8. Immutable audit and critical-operation confirmation flow.
