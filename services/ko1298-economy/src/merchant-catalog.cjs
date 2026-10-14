'use strict';

const { fail, normalizeId, assertCoinRange, PROTOCOL_MAX_COIN_VALUE } = require('./domain.cjs');

const VERIFIED_1298_MERCHANT_IDENTITIES = Object.freeze([
  Object.freeze({
    npcTemplateId: '13001',
    name: 'Caspy[Accessory]',
    zoneId: '21',
    sellingGroup: '203002',
    provenance: Object.freeze([
      Object.freeze({
        kind: 'SERVER_SQL',
        ref: 'Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab:ManualSetup/6_InsertData_K_NPC.sql',
      }),
      Object.freeze({
        kind: 'SERVER_SOURCE',
        ref: 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Server/Ebenezer/Npc.h',
      }),
    ]),
  }),
]);

const LEGACY_TABLE_PROVENANCE = Object.freeze([
  Object.freeze({
    kind: 'CLIENT_SOURCE',
    ref: 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Client/WarFare/UITransactionDlg.cpp',
  }),
  Object.freeze({
    kind: 'CLIENT_SOURCE',
    ref: 'Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5:src/Client/WarFare/IconItemSkill.cpp',
  }),
  Object.freeze({
    kind: 'CLIENT_TBL',
    ref: 'Open-KO/ko-client-assets@b4636332c7cd818b0ce171eccc973dd3d6b2e56d:Data/Item_Org_us.tbl.csv',
  }),
]);

class VerifiedMerchantCatalog {
  constructor({ identities = VERIFIED_1298_MERCHANT_IDENTITIES, offers = [] } = {}) {
    this.identitiesByKey = new Map();
    this.offersByKey = new Map();
    for (const identity of identities) this.addIdentity(identity);
    for (const offer of offers) this.addOffer(offer);
  }

  addIdentity(input) {
    const identity = normalizeIdentity(input);
    const key = identityKey(identity);
    if (this.identitiesByKey.has(key)) fail('DUPLICATE_MERCHANT_IDENTITY', 'merchant identity already exists', { key });
    this.identitiesByKey.set(key, identity);
    return structuredClone(identity);
  }

  addOffer(input) {
    const offer = normalizeOffer(input);
    if (![...this.identitiesByKey.values()].some((identity) => identity.sellingGroup === offer.sellingGroup)) {
      fail('UNVERIFIED_SELLING_GROUP', 'offer sellingGroup has no verified merchant identity', { sellingGroup: offer.sellingGroup });
    }
    const key = offerKey(offer.sellingGroup, offer.itemTemplateId);
    if (this.offersByKey.has(key)) fail('DUPLICATE_MERCHANT_OFFER', 'merchant offer already exists', { key });
    this.offersByKey.set(key, offer);
    return structuredClone(offer);
  }

  resolveIdentity({ npcTemplateId, zoneId, sellingGroup }) {
    const key = identityKey({
      npcTemplateId: normalizeId(npcTemplateId, 'npcTemplateId'),
      zoneId: normalizeId(zoneId, 'zoneId'),
      sellingGroup: normalizeId(sellingGroup, 'sellingGroup'),
    });
    const identity = this.identitiesByKey.get(key);
    return identity ? structuredClone(identity) : null;
  }

  getOffer({ sellingGroup, itemTemplateId }) {
    const offer = this.offersByKey.get(offerKey(
      normalizeId(sellingGroup, 'sellingGroup'),
      normalizeId(itemTemplateId, 'itemTemplateId'),
    ));
    return offer ? structuredClone(offer) : null;
  }

  listOffers(sellingGroup) {
    const group = normalizeId(sellingGroup, 'sellingGroup');
    return [...this.offersByKey.values()]
      .filter((offer) => offer.sellingGroup === group)
      .map((offer) => structuredClone(offer));
  }
}

class Legacy1298MerchantTableAdapter {
  constructor({ basicRows, getExtension, premiumSellPrice = false, provenance = LEGACY_TABLE_PROVENANCE }) {
    if (!basicRows || typeof basicRows[Symbol.iterator] !== 'function') throw new TypeError('basicRows must be iterable');
    if (typeof getExtension !== 'function') throw new TypeError('getExtension must be a function');
    this.basicRows = [...basicRows];
    this.getExtension = getExtension;
    this.premiumSellPrice = premiumSellPrice === true;
    this.provenance = normalizeProvenance(provenance);
  }

  listOffers(sellingGroup) {
    const { raw, basicSellGroup, extensionId } = splitSellingGroup(sellingGroup);
    const offers = [];
    for (const basicRow of this.basicRows) {
      if (readSafeInteger(basicRow, ['bySellGroup', 'SellingGroup'], 'bySellGroup') !== basicSellGroup) continue;
      const extIndex = readSafeInteger(basicRow, ['byExtIndex', 'ExtIndex'], 'byExtIndex');
      if (extIndex < 0) continue;
      const extensionRow = this.getExtension(extIndex, extensionId);
      if (!extensionRow) continue;
      const actualExtensionId = readSafeInteger(extensionRow, ['dwID', 'ID', 'Num'], 'extensionId');
      if (actualExtensionId !== extensionId) continue;
      const itemTemplateId = checkedItemId(
        readSafeInteger(basicRow, ['dwID', 'ID', 'Num'], 'basicItemId'),
        actualExtensionId,
      );
      const prices = resolveLegacy1298Prices({ basicRow, extensionRow, premiumSellPrice: this.premiumSellPrice });
      offers.push(Object.freeze({
        sellingGroup: raw,
        itemTemplateId: String(itemTemplateId),
        npcSellPrice: prices.npcSellPrice,
        npcBuyPrice: prices.npcBuyPrice,
        canBuy: true,
        canSell: true,
        provenance: this.provenance,
      }));
    }
    return offers.map((offer) => structuredClone(offer));
  }
}

function splitSellingGroup(value) {
  const raw = normalizeId(value, 'sellingGroup');
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > Number(PROTOCOL_MAX_COIN_VALUE)) {
    fail('INVALID_SELLING_GROUP', 'sellingGroup must be a positive uint32-compatible integer', { value });
  }
  return { raw: String(numeric), basicSellGroup: Math.floor(numeric / 1000), extensionId: numeric % 1000 };
}

function resolveLegacy1298Prices({ basicRow, extensionRow, premiumSellPrice = false }) {
  const basePrice = BigInt(readSafeInteger(basicRow, ['iPrice', 'BuyPrice'], 'basePrice'));
  const multiplier = BigInt(readSafeInteger(extensionRow, ['siPriceMultiply', 'PriceMultiply'], 'priceMultiplier'));
  const npcSellPrice = assertCoinRange(basePrice * multiplier, PROTOCOL_MAX_COIN_VALUE, 'npcSellPrice');
  const saleType = readSafeInteger(basicRow, ['iSaleType', 'SaleType'], 'saleType');
  if (![0, 1, 2].includes(saleType)) {
    fail('UNVERIFIED_SALE_TYPE', 'legacy sale type is outside verified 0/1/2 semantics', { saleType });
  }
  let npcBuyPrice = npcSellPrice;
  if (saleType !== 1) npcBuyPrice /= premiumSellPrice ? 4n : 6n;
  if (npcBuyPrice < 1n) npcBuyPrice = 1n;
  return { npcSellPrice, npcBuyPrice };
}

function normalizeIdentity(input) {
  if (!input || typeof input !== 'object') fail('INVALID_MERCHANT_IDENTITY', 'merchant identity is required');
  return Object.freeze({
    npcTemplateId: normalizeId(input.npcTemplateId, 'npcTemplateId'),
    name: String(input.name ?? '').trim(),
    zoneId: normalizeId(input.zoneId, 'zoneId'),
    sellingGroup: normalizeId(input.sellingGroup, 'sellingGroup'),
    provenance: normalizeProvenance(input.provenance),
  });
}

function normalizeOffer(input) {
  if (!input || typeof input !== 'object') fail('INVALID_MERCHANT_OFFER', 'merchant offer is required');
  const normalized = {
    sellingGroup: normalizeId(input.sellingGroup, 'sellingGroup'),
    itemTemplateId: normalizeId(input.itemTemplateId, 'itemTemplateId'),
    npcSellPrice: input.npcSellPrice == null ? null : assertCoinRange(input.npcSellPrice, PROTOCOL_MAX_COIN_VALUE, 'npcSellPrice'),
    npcBuyPrice: input.npcBuyPrice == null ? null : assertCoinRange(input.npcBuyPrice, PROTOCOL_MAX_COIN_VALUE, 'npcBuyPrice'),
    canBuy: input.canBuy !== false,
    canSell: input.canSell !== false,
    provenance: normalizeProvenance(input.provenance),
  };
  if (normalized.npcSellPrice == null && normalized.npcBuyPrice == null) {
    fail('INVALID_MERCHANT_OFFER', 'offer must define at least one canonical price');
  }
  return Object.freeze(normalized);
}

function normalizeProvenance(input) {
  if (!Array.isArray(input) || input.length === 0) fail('UNVERIFIED_MERCHANT_DATA', 'verified merchant data requires provenance');
  return Object.freeze(input.map((source) => {
    if (!source || typeof source !== 'object') fail('UNVERIFIED_MERCHANT_DATA', 'invalid provenance entry');
    return Object.freeze({ kind: normalizeId(source.kind, 'provenance.kind'), ref: normalizeId(source.ref, 'provenance.ref') });
  }));
}

function readSafeInteger(row, names, fieldName) {
  if (!row || typeof row !== 'object') fail('INVALID_MERCHANT_TABLE_ROW', `${fieldName} row is required`);
  const name = names.find((candidate) => row[candidate] != null);
  if (!name) fail('INVALID_MERCHANT_TABLE_ROW', `${fieldName} is missing`, { acceptedFields: names });
  const value = Number(row[name]);
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_MERCHANT_TABLE_ROW', `${fieldName} must be a non-negative safe integer`, { value: row[name] });
  return value;
}

function checkedItemId(basicId, extensionId) {
  const itemId = BigInt(basicId) + BigInt(extensionId);
  if (itemId < 0n || itemId > PROTOCOL_MAX_COIN_VALUE) fail('INVALID_ITEM_ID', 'combined item id exceeds uint32 range', { basicId, extensionId });
  return itemId;
}

function identityKey({ npcTemplateId, zoneId, sellingGroup }) {
  return `${npcTemplateId}:${zoneId}:${sellingGroup}`;
}

function offerKey(sellingGroup, itemTemplateId) {
  return `${sellingGroup}:${itemTemplateId}`;
}

module.exports = {
  VerifiedMerchantCatalog,
  Legacy1298MerchantTableAdapter,
  VERIFIED_1298_MERCHANT_IDENTITIES,
  LEGACY_TABLE_PROVENANCE,
  splitSellingGroup,
  resolveLegacy1298Prices,
};
