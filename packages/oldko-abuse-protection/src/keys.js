import { createHash, createHmac } from "node:crypto";

function requireText(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function createKeyBuilder({ hmacSecret, namespace = "oldko-abuse" }) {
  requireText("hmacSecret", hmacSecret);
  requireText("namespace", namespace);

  const digest = (kind, raw) =>
    createHmac("sha256", hmacSecret)
      .update(`${namespace}\0${kind}\0${requireText(kind, raw)}`)
      .digest("base64url")
      .slice(0, 32);

  const component = (kind, raw) => `${kind}:${digest(kind, raw)}`;

  return Object.freeze({
    ip: (rawIp) => component("ip", rawIp),
    account: (accountId) => component("account", accountId),
    actor: (actorId) => component("actor", actorId),
    service: (serviceId) => component("service", serviceId),
    compose({ policy, action, keys }) {
      requireText("policy", policy);
      requireText("action", action);
      if (!Array.isArray(keys) || keys.length === 0) {
        throw new TypeError("keys must contain at least one opaque key component");
      }
      return [namespace, `policy:${policy}`, `action:${action}`, ...keys].join("|");
    }
  });
}

export function fingerprintBucketKey(bucketKey) {
  return createHash("sha256").update(requireText("bucketKey", bucketKey)).digest("hex").slice(0, 16);
}
