import path from 'node:path';
import { pathToFileURL } from 'node:url';

const providerRoot = process.env.WS07_PROVIDER_ROOT;
const databaseUrl = process.env.DATABASE_URL;
if (!providerRoot) throw new Error('WS07_PROVIDER_ROOT is required');
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const importFrom = async (relative) => import(pathToFileURL(path.join(providerRoot, relative)).href);
const { createPool } = await importFrom('services/oldko-data/src/index.js');
const { PgWs13AccountRepository } = await importFrom('services/oldko-data/src/adapters/ws13-account-api.js');
const { PgWs08AdminRepository } = await importFrom('services/oldko-data/src/adapters/ws08-admin.js');

const pool = createPool({ connectionString: databaseUrl, applicationName: 'ws30-domain-live-recovery', max: 2 });
try {
  const accountRepo = new PgWs13AccountRepository(pool);
  const account = await accountRepo.findByUsernameCanonical('recoveryuser');
  if (!account || account.username !== 'RecoveryUser' || account.passwordVersion !== 2) {
    throw new Error(`WS07 account adapter failed recovery read: ${JSON.stringify(account)}`);
  }
  const characters = await accountRepo.listCharactersByAccount(account.id);
  if (characters.length !== 1 || characters[0].name !== 'RecoveryHero' || characters[0].level !== 3) {
    throw new Error(`WS07 account adapter character read failed: ${JSON.stringify(characters)}`);
  }

  const adminRepo = new PgWs08AdminRepository(pool);
  const overview = await adminRepo.overview();
  if (overview.characters < 1 || overview.sanctions < 1) {
    throw new Error(`WS07 admin adapter overview failed: ${JSON.stringify(overview)}`);
  }
  const character = await adminRepo.getCharacter('RecoveryHero');
  if (!character || character.name !== 'RecoveryHero') {
    throw new Error(`WS07 admin adapter character read failed: ${JSON.stringify(character)}`);
  }
  const inventory = await adminRepo.getInventory('RecoveryHero');
  if (!inventory?.equipment?.[0] || inventory.equipment[0].empty === true) {
    throw new Error(`WS07 admin adapter inventory read failed: ${JSON.stringify(inventory)}`);
  }

  console.log(JSON.stringify({
    accountAdapter: 'PASS',
    adminAdapter: 'PASS',
    accountId: account.id,
    character: characters[0].name,
    overview
  }));
} finally {
  await pool.end();
}
