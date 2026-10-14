WS09

# Dependency Snapshot — Permanent domain release

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Permanent release implementation commit: `a0c968e6e09e5b26911ebfb0431c062593ad456c`.
- WS09 deployment config run `38609175733`: SUCCESS.
- WS09 production readiness run `38609175508`: SUCCESS.
- WS09 permanent release bundle run `38609175962`: SUCCESS.
- Permanent host bundle: `ws09-c5-permanent-host-bundle-1`, artifact `11916143558`, digest `sha256:dace8c076b51eb70e4dc5196830655a32af17156ee04877402e080faa2a3e3ca`.

## CANONICAL GAMEPLAY RELEASE

```text
FINAL_PROVIDER_SET      WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS50 manifest commit    0d5001095fa3b43693b4fa0cda615f84e2cb7df5
WS50 handoff commit     7497087d4cf67e4e05a3a090f6edad3d206078cb
WS49 run                38600254823 / SUCCESS
WS10 run                38604174659 / SUCCESS
WS10 head               163f2ebf81e750bf746fdaa277695329a0682e22
PASS artifact           ws10-c5-visibility-e2e-4
client artifact         ws10-c5-visibility-passing-client-4
client artifact id      11915666463
client artifact digest  sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

The C5 manifest's historical browser baseline/run #26 is not the publication client for this release.

Frozen provider refs used for the host bundle:

```text
WS01 57d0aa7c6a82810d5f126bda83a368e7eb7801bb
WS02 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03 495de481726734d85cc28b3d432835799aff7e48
WS11 944b6ff9b6329af29f1048a74aa6e14fca141639
WS12 121bb7bdb82c364bf9459111096f5ff007873a61
WS14 ed5f806ce7505f4dfae406e4164735def63b6c86
WS15 ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d
WS16 5ed48ff32187000312652838674388df52fc3fb7
WS25 13c9bafe287b250d56b52f19e97a02e7ef18e6e5
WS31 546d2ab62cd46a97f3385ebcddbe0c775a02c2eb
WS38 5f323f3cf055ba7f96d928605a2f2faf84e609cb
WS45 4a66338743553c2781c68ca84b866ff4e999c14e
```

## PERSISTENCE / ACCOUNT OWNERS

### WS07

- Branch: `ws07-database`
- Observed head: `10008ad1698b79c01d87cde54463d49f3bf623a2`
- PostgreSQL foundation: GREEN.
- Publishes asynchronous PostgreSQL repositories including WS03 session persistence.

### WS03

- Observed head: `495de481726734d85cc28b3d432835799aff7e48`
- Blocker: current repository call sites are synchronous while the production WS07 adapter is asynchronous. Game auth/character persistence is therefore not yet production-composed.

### WS13

- Observed head: `23ac239b26e0353bf2da6f9c9649710db58e3a9a`
- Blocker: production requires an external repository module; current WS13 account/password/verification semantics are not yet proven compatible with the WS07/game credential model.
- Acceptance: website-created account and game login must use one real PostgreSQL-backed account identity/credential authority.

### WS08

- Observed head: `239cdacf0fb6bacde5017fb3b787451595a3be0d`
- Blocker: production must replace `MemoryAdminRepository` with the WS07-backed required repository surface.

Any gameplay/auth runtime integration that changes C5 composition requires a WS50 child candidate; C5 remains immutable.

## WEBSITE HANDOFF

- Branch: `official-site-domain-release`.
- Last observed branch head: `c75118905217343d30d3e25cf24a1552a5dc82b1`.
- Required handoff: `coordination/handoffs/official-site-release.json`.
- Last active read: NOT FOUND.
- WS09 must not guess/reimplement website source or public account routes while the handoff is absent.

## DOMAIN / HOST

- Domain: `oldkoweb.com` — owned/purchased.
- Target names: apex, `play`, `admin`.
- Persistent host: no authorized target/stable public address available to WS09 yet.
- Authoritative DNS provider connection: not available to WS09 yet.
- DNS mutations in this permanent-domain task: none yet, because a verified target is a prerequisite.
- Once a target exists, current task authorizes controlled cutover after existing zone records are inspected and preserved.

## LIVE-CUTOVER BLOCKERS

1. Authorized persistent host + stable public target.
2. WS03/WS07 persistent game-session composition.
3. WS13/WS07 shared real website/game account source.
4. WS08/WS07 production admin repository.
5. Official-site release handoff file/artifact/route contract.
6. Authoritative DNS inspection, apex/play/admin cutover and SAN TLS.
7. Real-domain browser E2E, restart persistence and rollback proof.

Quick Tunnel remains test/fallback evidence only; it is not a production host or DNS target.
