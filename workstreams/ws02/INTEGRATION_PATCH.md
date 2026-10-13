# WS02 Integration Patch Notes

No shared-file changes are required for the gateway implementation itself.

Future client/runtime integration (owned by the relevant workstream) should configure the browser transport to connect to the deployed WebSocket URL, for example `wss://gateway.oldkoweb.com/auth` and/or `/game`, without changing KO packet bytes. The concrete hostname and DNS/TLS deployment remain external configuration and are intentionally not assumed here.
