import { describe, expect, it } from "vitest";
import { buildLanAccess, type NetworkInterfaceMap } from "./lanAccess.js";

describe("LAN access discovery", () => {
  const interfaces: NetworkInterfaceMap = {
    "Loopback Pseudo-Interface 1": [
      { address: "127.0.0.1", family: "IPv4", internal: true },
    ],
    "Wi-Fi": [{ address: "192.168.1.10", family: "IPv4", internal: false }],
    Ethernet: [{ address: "10.0.0.8", family: "IPv4", internal: false }],
    "APIPA": [{ address: "169.254.1.5", family: "IPv4", internal: false }],
    singbox_tun: [{ address: "172.18.0.1", family: "IPv4", internal: false }],
    "vEthernet (WSL)": [
      { address: "172.20.0.1", family: "IPv4", internal: false },
    ],
  };

  it("returns copyable LAN URLs for a 0.0.0.0 bind", () => {
    const access = buildLanAccess(
      { host: "0.0.0.0", port: 18930 },
      interfaces,
    );

    expect(access.localUrl).toBe("http://127.0.0.1:18930/");
    expect(access.urls.map((entry) => entry.url)).toEqual([
      "http://192.168.1.10:18930/",
      "http://10.0.0.8:18930/",
    ]);
    expect(access.warnings).toEqual([]);
  });

  it("warns when the current bind host is local only", () => {
    const access = buildLanAccess(
      { host: "127.0.0.1", port: 18930 },
      interfaces,
    );

    expect(access.urls).toEqual([]);
    expect(access.warnings.join(" ")).toContain("localhost");
  });

  it("keeps only the matching address for a specific LAN bind", () => {
    const access = buildLanAccess(
      { host: "10.0.0.8", port: 18930 },
      interfaces,
    );

    expect(access.urls).toHaveLength(1);
    expect(access.urls[0]?.address).toBe("10.0.0.8");
  });
});
