# WS39 Dependency Graph

Legend: `--X-->` breaking, `----->` non-breaking/pending.

- `WS03` --X--> `WS34` — `character.create.session-to-rules`
- `WS03` --X--> `WS14` — `world.entry.session-to-world`
- `WS14` --X--> `WS15` — `movement.world-to-sync`
- `WS14` --X--> `WS16` — `npc.world-to-npc`
- `WS16` --X--> `WS22` — `merchant.npc-to-economy`
- `WS16` --X--> `WS23` — `quest.npc-to-quest`
- `WS17` --X--> `WS22` — `inventory.items-to-economy`
- `WS17` -----> `WS33` — `inn.items-to-storage`
- `WS19` --X--> `WS25` — `combat.combat-to-mobs`
- `WS25` --X--> `WS26` — `loot.mobs-to-loot`
- `WS19/WS25` --X--> `WS27` — `progression.combat-mob-to-progression`
- `WS08` --X--> `WS28` — `gm.admin-to-command-bus`
- `WS07` --X--> `WS03/WS08/WS13/WS17` — `persistence.data-to-consumers`
- `WS12` --X--> `WS38` — `content.launcher-to-manifest`
- `WS18` --X--> `WS32` — `friends.social-to-messenger`
- `WS29` -----> `BACKEND_SERVICES` — `observability.common-adoption`

## Mermaid

```mermaid
graph LR
  WS03["WS03"] -->|character.create.session-to-rules| WS34["WS34"]
  WS03["WS03"] -->|world.entry.session-to-world| WS14["WS14"]
  WS14["WS14"] -->|movement.world-to-sync| WS15["WS15"]
  WS14["WS14"] -->|npc.world-to-npc| WS16["WS16"]
  WS16["WS16"] -->|merchant.npc-to-economy| WS22["WS22"]
  WS16["WS16"] -->|quest.npc-to-quest| WS23["WS23"]
  WS17["WS17"] -->|inventory.items-to-economy| WS22["WS22"]
  WS17["WS17"] -->|inn.items-to-storage| WS33["WS33"]
  WS19["WS19"] -->|combat.combat-to-mobs| WS25["WS25"]
  WS25["WS25"] -->|loot.mobs-to-loot| WS26["WS26"]
  WS19_WS25["WS19/WS25"] -->|progression.combat-mob-to-progression| WS27["WS27"]
  WS08["WS08"] -->|gm.admin-to-command-bus| WS28["WS28"]
  WS07["WS07"] -->|persistence.data-to-consumers| WS03_WS08_WS13_WS17["WS03/WS08/WS13/WS17"]
  WS12["WS12"] -->|content.launcher-to-manifest| WS38["WS38"]
  WS18["WS18"] -->|friends.social-to-messenger| WS32["WS32"]
  WS29["WS29"] -->|observability.common-adoption| BACKEND_SERVICES["BACKEND_SERVICES"]
```
