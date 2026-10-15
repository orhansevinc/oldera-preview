# P2-09 social runtime contracts

This package continues WS18/WS21/WS24/WS32/WS37 without taking ownership of the Phase 2 shared session dispatcher/composition.

## P2-00 shared wiring request

Route authenticated in-game packets `0x10`, `0x35`, and `0x2f` to `P2SocialRuntimeAdapter.routePacket(sessionId, packet)`. Call session lifecycle hooks on selected-character ready, transport disconnect, reconnect-grace expiry, and authoritative zone change. The final dispatcher must deny player `0x40` operator packets.

The source verifies the `0x3c` Knights family/sub-opcodes and `0x49` Friend family/sub-opcodes, but the exact 1298 request/response byte layouts used by the accepted C++ client have not been verified in the retained WS21/WS32 work. Do not invent them. Until P2-10/P2-00 pins those layouts, raw `0x3c`/`0x49` returns `CLIENT_CODEC_NOT_VERIFIED`; the clan/friend domain ports remain callable by verified client actions once their codec is supplied.

## P2-04 world contract

World owns zone state and coordinate safe areas. Supply `battleOpen`, `invasionOpen`, and `inSafeArea` facts; call `onZoneChanged()` after an authoritative transition. The returned `zoneEpoch` is part of attack validation, preventing pre-transition attack requests from applying after a zone change.

## P2-07 combat/progression contract

Before damage application call `validateAttack()`. Only P2-07 can emit `authority: "P2-07_AUTHORITATIVE_COMBAT"` outcomes. `onCombatOutcome()` deduplicates by `eventId`, rejects client score claims, and forwards kill/death/NP mutations to the P2-11 sink. P2-09 does not invent NP amounts; P2-07 supplies the authoritative `npAward`/`npLoss` after its source-backed combat/progression calculation.

For party EXP, P2-07 calls `partyCombatShare(characterId,event,eligible)` where `eligible` implements P2-07's source-backed level/range rules. P2-09 supplies stable accepted party membership, online state, zone and level; it does not duplicate the combat formula.

## P2-08 item/loot contract

For a loot event P2-08 calls `partyLootShare(characterId,event,eligible)`. P2-09 supplies the stable party snapshot; P2-08 owns item ownership, transaction atomicity and the source-backed loot selection/distribution rule.

## P2-11 persistence/admin contract

Production must inject: (1) WS32-compatible atomic friend repository, (2) WS21-compatible clan repository, (3) `applyCombatSocialOutcome(mutation)` with unique `event_id` idempotency, and (4) `readRankingRows(query)` over persisted score state; P2-09 computes stable competition ranks from those rows. Runtime memory state is only valid for ephemeral party/invite/presence/session data.

Required persisted fields include canonical friendships, pending requests, directional blocks, clan/membership/role/grade/ranking state, and combat social outcome idempotency + kill/death/NP projection. Admin writes must use admin authority, never the player command surface.

## P2-10 client actions

Verified packet actions: general chat, private target + whisper, party create/invite/accept/reject/leave/kick/delete, party chat, clan chat type `6`, shout chat type `5` subject to P2-07/P2-08 resource authorization. Source-backed domain actions awaiting exact client codec: friend request/list/add/remove and Knights create/join/withdraw/remove/destroy/admit/reject/punish/chief/vice-chief/officer/member lists.

## P2-13 acceptance matrix

Use at least two controlled accounts. Validate nearby chat isolation, whisper + block, party concurrent invite, reject, accept, party chat, kick, member disconnect/reconnect, leader reconnect during P2-01 grace, leader lease expiry cleanup, clan permission denial/allow, friend online/offline, Moradon/Eslant/home/CZ safe-area rules, stale-zone attack rejection, one-and-only-one kill/death/NP application, relog state, and player denial of GM/operator commands. No live-player bulk messages/invites.

## Source gaps that remain explicit

- The retained 1298 source verifies the Knights and Friend opcode families/sub-operations, but not the exact accepted browser-client byte layouts needed for a safe raw codec; `0x3c`/`0x49` stay fail-closed.
- WS18 source behavior dissolves a party when the leader's reconnect lease expires. A client-visible leader-transfer packet/flow has not been source-verified for this retained target, so P2-09 does not invent one.
- WS24 verifies battle/invasion gating, but P2-09 has no source-backed event scheduler/victory/reward table beyond those runtime flags. No synthetic war event is presented as original.
