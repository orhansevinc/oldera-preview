import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCatalogAdapter,
  developmentCredential,
  fixtureId,
  fixtureSerial,
  flattenScenarioManifests,
  materializeScenario,
  validateScenarioManifest
} from "../../packages/oldko-test-fixtures/src/index.js";

const manifestDir = new URL("../../test-scenarios/manifests/", import.meta.url);

async function loadManifests() {
  const names = (await readdir(manifestDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(name, manifestDir), "utf8"))));
}

function findScenario(scenarios, id) {
  const scenario = scenarios.find((entry) => entry.id === id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) return value.forEach((entry) => walk(entry, visit));
  if (value && typeof value === "object") Object.values(value).forEach((entry) => walk(entry, visit));
}

test("all manifests validate and expose exactly 27 canonical scenarios", async () => {
  const manifests = await loadManifests();
  assert.equal(manifests.length, 6);
  for (const manifest of manifests) assert.deepEqual(validateScenarioManifest(manifest), []);
  const scenarios = flattenScenarioManifests(manifests);
  assert.equal(scenarios.length, 27);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 27);
  assert.equal(new Set(scenarios.map((scenario) => scenario.seed)).size, 27);
});

test("fixture identity and serial generation is deterministic and visibly namespaced", () => {
  assert.equal(fixtureId("account", "alpha", 7), fixtureId("account", "alpha", 7));
  assert.equal(fixtureSerial("item", "alpha", 7), fixtureSerial("item", "alpha", 7));
  assert.match(fixtureId("account", "alpha", 7), /^fx:ws49:account:alpha:[0-9a-f]{8}$/);
  assert.match(fixtureSerial("item", "alpha", 7), /^fxserial:ws49:item:alpha:[0-9a-f]{8}$/);
  assert.notEqual(fixtureId("account", "alpha", 7), fixtureId("account", "alpha", 8));
});

test("materializing the same scenario twice produces byte-equivalent data", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const scenario = findScenario(scenarios, "ws49.account.duplicate-login");
  assert.deepEqual(materializeScenario(scenario), materializeScenario(scenario));
});

test("real 1298 dependencies remain explicit WS31 refs when no catalog adapter is provided", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const scenario = findScenario(scenarios, "ws49.world.moradon-spawn");
  const result = materializeScenario(scenario);
  assert.deepEqual(result.payload.zone, { source: "WS31_CATALOG_REF", ref: "zone.moradon", unresolved: true });
  assert.deepEqual(result.payload.spawn, { source: "WS31_CATALOG_REF", ref: "spawn.moradon.default", unresolved: true });
});

test("strict catalog mode fails instead of inventing a numeric real-data ID", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const scenario = findScenario(scenarios, "ws49.character.karus");
  assert.throws(() => materializeScenario(scenario, { strictCatalog: true }), /unresolved WS31 catalog ref/);
});

test("WS31 adapter values keep catalog provenance", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const scenario = findScenario(scenarios, "ws49.character.karus");
  const adapter = createCatalogAdapter((ref) => ({ ref, idFromCatalog: 123 }));
  const result = materializeScenario(scenario, { catalogAdapter: adapter, strictCatalog: true });
  assert.equal(result.payload.character.nation.source, "WS31_CATALOG");
  assert.equal(result.payload.character.nation.ref, "nation.karus");
  assert.deepEqual(result.payload.character.nation.value, { ref: "nation.karus", idFromCatalog: 123 });
});

test("approved osevinc credential is development/test only", () => {
  assert.deepEqual(developmentCredential("osevinc", "test"), { username: "osevinc", password: "osevinc", testOnly: true });
  assert.deepEqual(developmentCredential("osevinc", "development"), { username: "osevinc", password: "osevinc", testOnly: true });
  assert.throws(() => developmentCredential("osevinc", "production"), /development\/test context/);
});

test("duplicate serial negative fixture intentionally duplicates serial but not instance identity", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const result = materializeScenario(findScenario(scenarios, "ws49.item.duplicate-serial-negative"));
  assert.equal(result.payload.items[0].serial, result.payload.items[1].serial);
  assert.notEqual(result.payload.items[0].instanceId, result.payload.items[1].instanceId);
  assert.equal(result.payload.negativeTest, true);
});

test("full-slot scenarios defer capacities instead of hard-coding patch data", async () => {
  const scenarios = flattenScenarioManifests(await loadManifests());
  const character = findScenario(scenarios, "ws49.character.full-character-slots");
  const inventory = findScenario(scenarios, "ws49.item.full-inventory");
  assert.deepEqual(character.payload.slotPolicy.capacity, { $catalog: "character.slot-capacity" });
  assert.deepEqual(inventory.payload.inventoryPolicy.capacity, { $catalog: "inventory.slot-capacity" });
});

test("canonical manifests contain no raw numeric *Id fields", async () => {
  const manifests = await loadManifests();
  for (const manifest of manifests) {
    walk(manifest, (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (/id$/i.test(key)) assert.notEqual(typeof child, "number", `raw numeric ID at ${manifest.category}.${key}`);
      }
    });
  }
});
