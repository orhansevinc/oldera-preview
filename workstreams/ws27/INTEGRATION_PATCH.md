# WS27 Integration Patch

## Construct

```js
const {
  ProgressionService,
  Verified1298PveDeathLossPolicy,
} = require('../../services/ko1298-progression');

const progression = new ProgressionService({
  levelTable,        // verified 1298 thresholds + max level
  levelRewardPort,   // stat/skill reward owner
  partyXpPort,       // exact party formula owner
  respawnPointPort,  // world/zone spawn owner
  nationPointPort,   // optional WS24/rules handoff
  deathLossPolicy: new Verified1298PveDeathLossPolicy(),
});
```

## WS25 / WS26 mob reward -> XP

```js
const result = progression.awardMonsterKill(characterProgressionState, {
  xp: reward.xp,
  mobInstanceId: reward.mobInstanceId,
  mobTemplateId: reward.mobTemplateId,
});
```

Persist/broadcast returned state/events in the owning layers. WS27 does not import WS25/WS26.

## Party XP

Supply `PartyXpPort.allocate()` only after exact 1298 party eligibility and split rules are verified.

```js
const results = progression.awardPartyMonsterKill(memberStates, {
  xp: reward.xp,
  mobInstanceId: reward.mobInstanceId,
  mobTemplateId: reward.mobTemplateId,
});
```

The allocator must return one unique allocation for every supplied member.

## WS19 level rewards

`LevelRewardPort.onLevelUp()` is invoked for every crossed level, including multi-level XP awards. WS19/final composition applies stat/skill changes from verified patch data; WS27 does not modify combat/stat code.

## Death + WS24 seam

```js
const deathResult = progression.markDead(state, {
  kind: 'monster', // or 'player'
  killerId,
  zoneId,
  occurredAt,
}, {
  allowXpLoss: zoneRules.allowXpLossOnDeath,
});
```

The default policy applies only the verified conservative PvE rule: monster death, level 6+, 1% of configured current-level XP cap. PvP XP loss remains zero unless a separately verified policy is supplied.

## Nation points

```js
const nationPointPort = {
  onDeath({ characterId, death }) {
    return rules.handleNationPointDeath({ characterId, death });
  },
};
```

WS27 does not calculate NP.

## Respawn

```js
const respawnResult = progression.respawn(deadState, {
  requestedPointId,
  zoneId,
});
```

`RespawnPointPort.resolve()` supplies the destination. WS14/WS15 or final composition owns the actual world relocation and packets.

## Persistence boundary

Recommended ordering:

1. validate/compute progression transition;
2. persist progression + owned reward state atomically where possible;
3. publish/broadcast emitted events only after commit.

WS27 adds no DB schema or migration.

## Required before production

- verified 1298 XP table;
- exact target-patch max level;
- verified level-up stat/skill awards;
- verified party XP formula;
- verified PvP XP-loss behavior if any;
- world-owned respawn point data.
