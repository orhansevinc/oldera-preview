# WS39 Compatibility Issues

Current registry: **14 breaking / 16 priority contracts**.

WS39 records only; it does not patch provider/consumer product code.

## ISSUE-01

PROVIDER: WS03
CONSUMER: WS34
CONTRACT: character.create.session-to-rules
EXPECTED: validateCharacterCreate; createCharacterResult; accountId:string; slot:uint8; name:string; nation:uint8; race:uint8; classId:uint16; face:uint8; hair:uint8; server-authoritative-validation; explicit-accept-reject-result
ACTUAL: WS03-create-select-response-missing; WS34-ahead-by-0
BREAKING: YES
RECOMMENDED_OWNER_WS: WS34

## ISSUE-02

PROVIDER: WS03
CONSUMER: WS14
CONTRACT: world.entry.session-to-world
EXPECTED: handoffSelectedCharacter; bootstrapWorldSession; sessionId:string; characterId:string|integer; zoneId:integer; position:object; post-select-authoritative-handoff; disconnect-ownership
ACTUAL: WS03-post-select-bootstrap-missing; WS14-branch-missing
BREAKING: YES
RECOMMENDED_OWNER_WS: WS14

## ISSUE-03

PROVIDER: WS14
CONSUMER: WS15
CONTRACT: movement.world-to-sync
EXPECTED: zoneBounds.isValidPosition; registerSession; teleport; sessionId:string; entityId:string|integer; zoneId:integer; position:object; headingRaw:int16; authoritative-spawn-baseline; warp-not-normal-move
ACTUAL: WS15-consumer-contract-published; WS14-provider-missing
BREAKING: YES
RECOMMENDED_OWNER_WS: WS14

## ISSUE-04

PROVIDER: WS14
CONSUMER: WS16
CONTRACT: npc.world-to-npc
EXPECTED: resolveTerrainY; dispatchNpcOpcode; zoneId:integer; position:object; real-terrain-height; authenticated-game-socket-dispatch
ACTUAL: WS16-awaits-terrain-y-and-opcode-wiring; WS14-provider-missing
BREAKING: YES
RECOMMENDED_OWNER_WS: WS14

## ISSUE-05

PROVIDER: WS16
CONSUMER: WS22
CONTRACT: merchant.npc-to-economy
EXPECTED: assertInteraction; getOffer; npcSellPrice:integer; npcBuyPrice:integer; canBuy:boolean; canSell:boolean; npc-type-zone-range-state-validation; server-authoritative-price
ACTUAL: NpcInteractionRouter.route; context.session:object; context.npc:object; npc.sellingGroup:uint32; unknown-npc-check; zone-check; merchant-callback; no-range-validation; no-offer-price-api
BREAKING: YES
RECOMMENDED_OWNER_WS: WS16

## ISSUE-06

PROVIDER: WS16
CONSUMER: WS23
CONTRACT: quest.npc-to-quest
EXPECTED: questRouter.route; npcId:integer; action:string|integer; characterId:string|integer; player.level:integer; player.classId:integer; player.nationId:integer; instance-to-template-validation; verified-menu-action; interaction-range-validation
ACTUAL: NpcInteractionRouter.route; instanceId:uint16; context.session:object; context.npc:object; instance-validation; zone-check; no-action-field; no-range-validation
BREAKING: YES
RECOMMENDED_OWNER_WS: WS16

## ISSUE-07

PROVIDER: WS17
CONSUMER: WS22
CONTRACT: inventory.items-to-economy
EXPECTED: canReceiveNpcPurchase; addNpcPurchase; getOwnedItem; removeOwnedItem; countSerial; canReceiveTrade; transferItem; tx:transaction-context; caller-supplied-single-transaction; global-serial-authority; atomic-coin-item-trade
ACTUAL: createItem; move; equip; unequip; moveToInn; moveFromInn; repository.transact(ownerId,work):function; WS17-opens-owner-transaction; global-serial-index-in-memory; no-caller-tx-port
BREAKING: YES
RECOMMENDED_OWNER_WS: WS17

## ISSUE-08

PROVIDER: WS17
CONSUMER: WS33
CONTRACT: inn.items-to-storage
EXPECTED: createWs17CompatibleItemPort; templates.get:function; createItemInstance:function; withQuantity:function; account-scoped-storage; WS17-item-serial-authority; WS33-owned-cross-scope-transaction
ACTUAL: createWs17CompatibleItemPort; templates.get:function; createItemInstance:function; withQuantity:function; account-scoped-storage; WS17-item-serial-authority; WS33-owned-cross-scope-transaction
BREAKING: NO
RECOMMENDED_OWNER_WS: WS33

## ISSUE-09

PROVIDER: WS19
CONSUMER: WS25
CONTRACT: combat.combat-to-mobs
EXPECTED: isTargetAlive; canAggro; target.id:string|integer; target.zoneId:integer; target.position:object; authoritative-life-state; explicit-mob-target-policy
ACTUAL: createCombatant; CombatService.normalAttack; lifeState:ALIVE|DEAD; hp:number; authoritative-life-state-available; no-canAggro-or-canMobTarget-public-api
BREAKING: YES
RECOMMENDED_OWNER_WS: WS19

## ISSUE-10

PROVIDER: WS25
CONSUMER: WS26
CONTRACT: loot.mobs-to-loot
EXPECTED: createFromMobDeath; eventId:string; mobInstanceId:string; mobTemplateId:string|integer; killerCharacterId:string|integer; zoneId:integer; position:object; diedAt:number; stable-death-event-idempotency-key
ACTUAL: onMobStateChange; mob.id:string; mob.templateId:string|integer; mob.zoneId:integer; mob.position:object; event.type:string; event.atMs:number; dead-state-event; meta-pass-through; no-stable-eventId-guarantee
BREAKING: YES
RECOMMENDED_OWNER_WS: WS25

## ISSUE-11

PROVIDER: WS19/WS25
CONSUMER: WS27
CONTRACT: progression.combat-mob-to-progression
EXPECTED: awardMonsterKill; xp:bigint-compatible; mobInstanceId:string; mobTemplateId:string|integer; authoritative-xp-reward-source; single-death-reward-application
ACTUAL: CombatService.normalAttack; MobService.applyHealth; death:boolean; mobTemplateId:string|integer; death-state-available; no-authoritative-xp-amount-output
BREAKING: YES
RECOMMENDED_OWNER_WS: WS25

## ISSUE-12

PROVIDER: WS08
CONSUMER: WS28
CONTRACT: gm.admin-to-command-bus
EXPECTED: executeCanonicalCommand; command:string; actor:object; requestId:string; reason:string; args:object; legacy-to-canonical-translation; server-authenticated-actor; idempotency; audit-before-execution
ACTUAL: enqueueCommand; status:PENDING_BRIDGE; WS08-command-outbox; WS28-translation-guide-published; no-live-bridge
BREAKING: YES
RECOMMENDED_OWNER_WS: WS08

## ISSUE-13

PROVIDER: WS07
CONSUMER: WS03/WS08/WS13/WS17
CONTRACT: persistence.data-to-consumers
EXPECTED: consumer-specific-adapters; stable-repository-models; atomicity-preserved; consumer-signatures-satisfied; no-plaintext-auth-storage
ACTUAL: PgAccountRepository.findByUsername; PgCharacterRepository.createCharacter; PgInventoryRepository.moveItem; PgAdminRepository.appendAudit; WS03:authenticate/getNation/setNation; WS08:20 REQUIRED_METHODS; WS13:7 account/action-token methods; WS17:read/transact owner-state model; WS07-contract-published; consumer-adapters-not-implemented; method-shape-conflicts
BREAKING: YES
RECOMMENDED_OWNER_WS: WS07

## ISSUE-14

PROVIDER: WS12
CONSUMER: WS38
CONTRACT: content.launcher-to-manifest
EXPECTED: resolveContentManifest; verifyPackageIntegrity; contentVersion:string; files[].path:string; files[].sha256:string; files[].size:integer; publishedAt:string; manifest-versioning; integrity-before-launch; cdn-publication-identity
ACTUAL: HEAD-requiredFiles; parse-BUILD.txt; cacheVersion:string; client.entryUrl:string; client.buildUrl:string; client.requiredFiles:string[]; availability-check; query-cache-busting; no-content-manifest-or-hash-verification; WS38-ahead-by-0
BREAKING: YES
RECOMMENDED_OWNER_WS: WS38

## ISSUE-15

PROVIDER: WS18
CONSUMER: WS32
CONTRACT: friends.social-to-messenger
EXPECTED: canPrivateMessage; fromId:string|integer; toId:string|integer; block-check-on-target-selection; block-check-before-private-delivery; block-either-direction-denies
ACTUAL: WS32.createWs18QueryInterface; WS18.SocialService.handlePacket; WS18.constructor:send,nearbyRecipients,allowChat,canPartyTogether; WS32-canPrivateMessage-port-published; WS18-no-private-message-policy-hook; WS18-private-target-selection-and-delivery-internal
BREAKING: YES
RECOMMENDED_OWNER_WS: WS18

## ISSUE-16

PROVIDER: WS29
CONSUMER: BACKEND_SERVICES
CONTRACT: observability.common-adoption
EXPECTED: createLogger; createStandardMetrics; HealthRegistry; installGracefulShutdown; serviceName:string; serviceVersion:string; requestId:string?; single-process-bootstrap; bounded-metric-labels; sensitive-data-redaction; health-readiness-contract
ACTUAL: WS29-package-complete; product-services-intentionally-untouched
BREAKING: NO
RECOMMENDED_OWNER_WS: WS29

