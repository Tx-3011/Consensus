import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";

const trackingKeys = new Set(["gclid", "fbclid"]);

export function normalizeExternalUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password) throw new UnsafeUrlError("URL credentials are not permitted.");
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new UnsafeUrlError("Only ports 80 and 443 are permitted.");
  }
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLocaleLowerCase().startsWith("utm_") || trackingKeys.has(key.toLocaleLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

export async function resolvePublicAddresses(hostname: string) {
  const normalizedHost = hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (normalizedHost === "localhost" || normalizedHost.endsWith(".localhost") || normalizedHost.endsWith(".local") || normalizedHost.endsWith(".internal")) {
    throw new UnsafeUrlError("Local and internal hostnames are blocked.");
  }
  const literalFamily = net.isIP(normalizedHost);
  const addresses = literalFamily
    ? [{ address: normalizedHost, family: literalFamily }]
    : await dns.lookup(normalizedHost, { all: true, verbatim: true });
  validateResolvedAddresses(addresses);
  return addresses;
}

export function validateResolvedAddresses(addresses: Array<{ address: string; family: number }>) {
  if (!addresses.length) throw new UnsafeUrlError("Hostname did not resolve.");
  for (const entry of addresses) if (!isPublicAddress(entry.address)) throw new UnsafeUrlError(`Blocked non-public address: ${entry.address}`);
}

export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const comparable = parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
    ? (parsed as ipaddr.IPv6).toIPv4Address()
    : parsed;
  return comparable.range() === "unicast";
}

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeUrlError"; }
}
