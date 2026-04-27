import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNetworkGuard } from "./useNetworkGuard";
import { clearEnvCache } from "../lib/env";
import type { WalletState } from "../lib/freighter";

// ─── Mock env ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearEnvCache();
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wallet(overrides: Partial<WalletState> = {}): WalletState {
  return {
    connected: true,
    address: "GABC123",
    network: "TESTNET",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useNetworkGuard", () => {
  it("returns ok when wallet is not connected", () => {
    const { result } = renderHook(() =>
      useNetworkGuard({ connected: false, address: null, network: null }),
    );
    expect(result.current.mismatch).toBe(false);
    expect(result.current.severity).toBe("ok");
  });

  it("returns ok when networks match (case-insensitive)", () => {
    const { result } = renderHook(() =>
      useNetworkGuard(wallet({ network: "TESTNET" })),
    );
    expect(result.current.mismatch).toBe(false);
  });

  it("returns ok when networks match with lowercase env", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet");
    const { result } = renderHook(() =>
      useNetworkGuard(wallet({ network: "testnet" })),
    );
    expect(result.current.mismatch).toBe(false);
  });

  it("returns error mismatch when on mainnet but configured for testnet", () => {
    const { result } = renderHook(() =>
      useNetworkGuard(wallet({ network: "PUBLIC" })),
    );
    expect(result.current.mismatch).toBe(true);
    expect(result.current.severity).toBe("error");
    expect(result.current.actualNetwork).toBe("PUBLIC");
    expect(result.current.expectedNetwork).toBe("testnet");
    expect(result.current.message).toMatch(/testnet/i);
    expect(result.current.message).toMatch(/PUBLIC/i);
  });

  it("normalises mainnet -> public for comparison", () => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "mainnet");
    clearEnvCache();
    const { result } = renderHook(() =>
      useNetworkGuard(wallet({ network: "PUBLIC" })),
    );
    expect(result.current.mismatch).toBe(false);
  });

  it("returns mismatch when on futurenet", () => {
    const { result } = renderHook(() =>
      useNetworkGuard(wallet({ network: "FUTURENET" })),
    );
    expect(result.current.mismatch).toBe(true);
  });
});
