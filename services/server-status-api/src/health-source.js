/**
 * Health source adapter contract.
 *
 * Implementations may read heartbeat infrastructure, service discovery, a
 * status bus, or another internal source. They MUST NOT be exposed directly
 * over HTTP; ServerStatusService applies the public projection.
 *
 * listRealms(): Promise<Array<RealmHealthSnapshot>>
 * getRealm(realmId): Promise<RealmHealthSnapshot | null>
 */
export class HealthSource {
  async listRealms() {
    throw new Error('HealthSource.listRealms() is not implemented');
  }

  async getRealm(_realmId) {
    throw new Error('HealthSource.getRealm() is not implemented');
  }
}

export class InMemoryHealthSource extends HealthSource {
  constructor({ realms = [] } = {}) {
    super();
    this.realms = realms.map((realm) => structuredClone(realm));
  }

  async listRealms() {
    return this.realms.map((realm) => structuredClone(realm));
  }

  async getRealm(realmId) {
    const found = this.realms.find((realm) => realm.realmId === realmId);
    return found ? structuredClone(found) : null;
  }
}
