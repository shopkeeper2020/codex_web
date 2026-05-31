import { networkInterfaces } from "node:os";
import type { LanAccess } from "@codex-web/api";

type NetworkInterfaceInfo = {
  address?: string;
  family?: string | number;
  internal?: boolean;
};

export type NetworkInterfaceMap = Record<
  string,
  NetworkInterfaceInfo[] | undefined
>;

function isIpv4Family(value: string | number | undefined): boolean {
  return value === "IPv4" || value === 4;
}

function isUsableLanAddress(address: string): boolean {
  if (!address) return false;
  if (address === "0.0.0.0" || address === "255.255.255.255") return false;
  if (address.startsWith("127.") || address.startsWith("169.254.")) {
    return false;
  }
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address);
}

function isLikelyVirtualInterface(name: string): boolean {
  return /(?:loopback|pseudo|virtual|vEthernet|docker|wsl|hyper-v|vmware|virtualbox|tun|tap|vpn|singbox)/i.test(
    name,
  );
}

function privateAddressScore(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  const secondOctet = Number(address.split(".")[1]);
  if (address.startsWith("172.") && secondOctet >= 16 && secondOctet <= 31) {
    return 2;
  }
  return 3;
}

function canServeLanAddress(host: string, address: string): boolean {
  return (
    host === "0.0.0.0" ||
    host === "::" ||
    host === address ||
    host.trim().length === 0
  );
}

export function buildLanAccess(
  input: { host: string; port: number },
  interfaces: NetworkInterfaceMap = networkInterfaces() as NetworkInterfaceMap,
): LanAccess {
  const host = input.host.trim() || "0.0.0.0";
  const port = input.port;
  const warnings: string[] = [];
  const urls = Object.entries(interfaces)
    .flatMap(([name, entries]) =>
      (entries ?? []).flatMap((entry) => {
        const address = entry.address ?? "";
        if (isLikelyVirtualInterface(name)) return [];
        if (!isIpv4Family(entry.family)) return [];
        if (entry.internal) return [];
        if (!isUsableLanAddress(address)) return [];
        if (!canServeLanAddress(host, address)) return [];
        return [
          {
            name,
            address,
            family: "IPv4" as const,
            url: `http://${address}:${port}/`,
          },
        ];
      }),
    )
    .sort((left, right) => {
      const score = privateAddressScore(left.address) - privateAddressScore(right.address);
      if (score !== 0) return score;
      return left.name.localeCompare(right.name) || left.address.localeCompare(right.address);
    });

  if (host.startsWith("127.") || host === "localhost") {
    warnings.push("Server is bound to localhost, so LAN devices cannot connect.");
  }
  if (urls.length === 0) {
    warnings.push("No active LAN IPv4 address is available for the current bind host.");
  }

  return {
    host,
    port,
    localUrl: `http://127.0.0.1:${port}/`,
    urls,
    warnings,
  };
}
