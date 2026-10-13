# OldKO Control Center API

This is the server-side integration layer for `admin.oldkoweb.com`.

It is intentionally separate from the browser UI. The browser never receives SQL credentials and never writes directly to Knight Online tables.

## What is wired

- ROOT OWNER session login with HttpOnly signed cookie
- SQL Server connection to a 1298-compatible Knight Online database
- automatic detection of common `USERDATA`, `CURRENTUSER`, `WAREHOUSE` and `ACCOUNT_CHAR` column names
- live online-player lookup using `CURRENTUSER`
- character level / NP / coin / zone / coordinates from `USERDATA`
- 14 equipment + 28 inventory slot decoding from the 1298 `Item` and `Serial` binary blobs
- 192 Inn Hostess slot decoding from `WAREHOUSE.WarehouseData` and `WAREHOUSE.strSerial`
- account and IP ban registry
- immutable-style admin audit table
- optional game-server command bridge for GM operations and immediate ban enforcement

Open-KO 1298 confirms the standard current-user row contains `strAccountID`, `strCharID`, `nServerNo`, `strServerIP`, and `strClientIP`, and that USERDATA stores 14 equipment + 28 inventory slots while WAREHOUSE uses the 1298 binary item/serial layout.

## Development

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Set `KO_DB_ENABLED=true` only after filling in the SQL Server connection values.

## Production topology

Recommended:

```text
https://admin.oldkoweb.com
  /              -> static Control Center UI
  /api/admin/*   -> this Node service (127.0.0.1:8787)
```

Put nginx/Caddy/Cloudflare in front of it and terminate TLS there. Do not expose SQL Server to the public internet.

## Ban behavior

The API stores moderation state in `OLDKO_ADMIN_BANS`. This makes Control Center state auditable and reversible without modifying unknown account schemas.

For a ban to take effect immediately inside the running game/login server, set `GAME_COMMAND_BRIDGE_URL` to an authenticated server-side bridge. The API forwards `ACCOUNT_BAN`, `IP_BAN`, `BAN_REMOVE`, and the original 1298 GM commands to that bridge.

Until the game bridge exists, DB reads are live but sanctions are marked `STAGED`: they are persisted in the admin database and visible in the panel, but the running game process has not yet been instructed to disconnect/deny the player.

## Important production rules

- Change `ROOT_OWNER_PASSWORD` and `SESSION_SECRET`.
- Use HTTPS.
- Restrict API ingress to the admin host / reverse proxy.
- Give the SQL login only the permissions needed by the admin service.
- Keep the game command bridge private and require `GAME_COMMAND_BRIDGE_TOKEN`.
- Do not put any database password, owner password, or bridge token in frontend JavaScript.
