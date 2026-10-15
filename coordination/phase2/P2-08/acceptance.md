# P2-08 real-client acceptance gate

The provider must remain BLOCKED until the exact integrated candidate passes all of the following on the intended Windows PC/Docker/PostgreSQL runtime with the real C++/WASM client:

- mob death -> source-backed drop -> ground visibility -> ownership gate -> one successful pickup -> inventory/equip/use -> service restart/relog persistence;
- real NPC buy/sell and repair with full-bag, insufficient-gold, bad-range and disconnect-before-commit failures leaving item+gold unchanged;
- source-backed anvil/upgrade with client-supplied rate/outcome rejected and replay of the same operation id not charging/consuming twice;
- Inn deposit/withdraw survives restart and cannot place one serial in inventory/equipment/Inn simultaneously;
- two real clients perform a trade, including double-confirm/replay and recipient-full rollback, with item/coin conservation;
- concurrent pickup/bank/trade/player-merchant attempts against the same serial produce exactly one committed owner/location;
- final database check returns zero duplicate serials and zero duplicate placements.

Service/unit tests are supporting evidence only and never satisfy this gate.
