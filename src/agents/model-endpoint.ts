import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

/** Network location of the resolved model endpoint, not the provider's display name. */
export type ModelEndpointLocation = "external" | "local" | "unknown";

/**
 * Classifies resolved model URLs for runtime policy hooks. Unknown URLs stay
 * distinct from external ones so privacy-sensitive policies can fail closed.
 */
export function classifyModelEndpoint(baseUrl: string | undefined): ModelEndpointLocation {
  if (!baseUrl) {
    return "unknown";
  }
  try {
    const url = new URL(baseUrl);
    const host = normalizeLowercaseStringOrEmpty(url.hostname).replace(/^\[|\]$/g, "");
    if (isLocalHost(host)) {
      return "local";
    }
    return url.protocol === "https:" ? "external" : "unknown";
  } catch {
    return "unknown";
  }
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "::ffff:7f00:1" ||
    host === "::ffff:127.0.0.1" ||
    host === "docker.orb.internal" ||
    host === "host.docker.internal" ||
    host === "host.orb.internal" ||
    host.endsWith(".local") ||
    isPrivateIpv4Host(host)
  );
}

function isPrivateIpv4Host(host: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(host)) {
    return false;
  }
  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}
