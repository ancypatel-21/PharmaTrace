import { describe, expect, it } from "vitest";
import { isLoopbackHost, resolveContractConfig } from "./config.js";
import { isLocalOnlyUrl, publicBaseUrl, verifyUrl } from "./qr.js";

describe("verifyUrl", () => {
  it("builds the verify deep link without double slashes", () => {
    expect(verifyUrl(1, "http://192.168.1.20:5173")).toBe("http://192.168.1.20:5173/verify/1");
    expect(verifyUrl(12n, "https://pharmatrace.example/")).toBe("https://pharmatrace.example/verify/12");
  });
});

describe("publicBaseUrl", () => {
  it("prefers VITE_PUBLIC_URL and falls back to the page origin", () => {
    expect(publicBaseUrl("http://10.0.0.5:5173/", "http://localhost:5173")).toBe("http://10.0.0.5:5173");
    expect(publicBaseUrl("", "http://localhost:5173")).toBe("http://localhost:5173");
  });
});

describe("isLocalOnlyUrl / isLoopbackHost", () => {
  it("flags links a phone cannot open", () => {
    expect(isLocalOnlyUrl("http://localhost:5173/verify/1")).toBe(true);
    expect(isLocalOnlyUrl("http://127.0.0.1:5173/verify/1")).toBe(true);
    expect(isLocalOnlyUrl("http://[::1]:5173/verify/1")).toBe(true);
    expect(isLocalOnlyUrl("http://192.168.1.20:5173/verify/1")).toBe(false);
    expect(isLocalOnlyUrl("not a url")).toBe(false);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
  });
});

describe("local RPC follows the page host (phone scanning a QR)", () => {
  const files = {
    "../contracts/localhost.json": { chainId: 31337, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", abi: [] },
  };

  it("uses 127.0.0.1 when the app is opened on this computer", () => {
    expect(resolveContractConfig(files, "localhost", { pageHostname: "localhost" }).rpcUrl).toBe(
      "http://127.0.0.1:8545",
    );
  });

  it("uses the LAN host when the app is opened from another device", () => {
    expect(resolveContractConfig(files, "localhost", { pageHostname: "192.168.1.20" }).rpcUrl).toBe(
      "http://192.168.1.20:8545",
    );
  });

  it("keeps VITE_RPC_URL and the Amoy RPC unchanged", () => {
    expect(
      resolveContractConfig(files, "localhost", { pageHostname: "192.168.1.20", rpcUrl: "http://x:1" }).rpcUrl,
    ).toBe("http://x:1");
    expect(resolveContractConfig({}, "amoy", { pageHostname: "192.168.1.20" }).rpcUrl).toBe(
      "https://rpc-amoy.polygon.technology",
    );
  });
});
