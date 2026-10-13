function stripAddressDecorations(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const close = raw.indexOf("]");
    return close > 0 ? raw.slice(1, close) : raw;
  }
  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1 && /:\d+$/.test(raw)) return raw.replace(/:\d+$/, "");
  return raw;
}

export function exactTrustedProxies(addresses = []) {
  const trusted = new Set(addresses.map(stripAddressDecorations).filter(Boolean));
  return (address) => trusted.has(stripAddressDecorations(address));
}

export function resolveClientIp({ remoteAddress, headers = {} }, { trustProxy } = {}) {
  const remote = stripAddressDecorations(remoteAddress);
  if (!remote) throw new TypeError("remoteAddress is required");

  if (typeof trustProxy !== "function" || !trustProxy(remote, 0)) {
    return Object.freeze({ ip: remote, source: "socket", forwardedAccepted: false, hopCount: 0 });
  }

  const rawForwarded = headers["x-forwarded-for"] ?? headers["X-Forwarded-For"];
  if (typeof rawForwarded !== "string" || rawForwarded.trim() === "") {
    return Object.freeze({ ip: remote, source: "socket", forwardedAccepted: false, hopCount: 0 });
  }

  const forwarded = rawForwarded
    .split(",")
    .map(stripAddressDecorations)
    .filter(Boolean);
  if (forwarded.length === 0) {
    return Object.freeze({ ip: remote, source: "socket", forwardedAccepted: false, hopCount: 0 });
  }

  // XFF is client, proxy1, proxy2... Walk from the socket backwards only while
  // the current hop is explicitly trusted. The first untrusted address is the client.
  const chain = [...forwarded, remote];
  let index = chain.length - 1;
  let trustedHops = 0;
  while (index > 0 && trustProxy(chain[index], trustedHops)) {
    index -= 1;
    trustedHops += 1;
  }

  return Object.freeze({
    ip: chain[index],
    source: "x-forwarded-for",
    forwardedAccepted: true,
    hopCount: trustedHops
  });
}
