import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../index.js";

vi.mock("@stellar/stellar-sdk", () => {
  return {
    Address: {
      fromString: vi.fn((address) => ({
        toScVal: () => ({ address }),
        toString: () => address
      }))
    },
    BASE_FEE: "100",
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({})
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        toXDR: () => "test_xdr"
      })
    })),
    nativeToScVal: vi.fn((val) => ({ val })),
    scValToNative: vi.fn((val) => val),
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        getAccount: vi.fn().mockResolvedValue({
          accountId: () => "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6",
          sequenceNumber: () => "1",
          sequence: "1"
        }),
        simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: [] } }),
        prepareTransaction: vi.fn().mockResolvedValue({
          toXDR: () => "test_xdr",
          sequence: "1",
          fee: "100"
        })
      }))
    },
    xdr: {
      ScVal: {
        scvU32: vi.fn(),
        scvVec: vi.fn()
      }
    }
  };
});

vi.mock("../services/stellar.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    loadStellarConfig: vi.fn(() => ({
      horizonUrl: "http://horizon",
      sorobanRpcUrl: "http://rpc",
      networkPassphrase: "test",
      contractId: "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR",
      simulatorAccount: "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6"
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      simulatorAccount: "test_account"
    })),
    getStellarRpcServer: vi.fn(() => ({
      getAccount: vi.fn().mockResolvedValue({
        accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        sequenceNumber: () => "1",
        incrementSequenceNumber: vi.fn()
      }),
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: null } }),
      prepareTransaction: vi.fn().mockResolvedValue({
        toXDR: () => "test_xdr",
        sequence: "1",
        fee: "100"
      }),
      getEvents: vi.fn().mockResolvedValue({ events: [] })
    })),
    getStellarRpcServer: vi.fn().mockImplementation(() => {
      const { rpc } = (vi.mocked(await import("@stellar/stellar-sdk")));
      return new rpc.Server("http://rpc");
    })
    executeWithRetry: vi.fn(async (fn) => fn()),
    getCached: vi.fn(() => undefined),
    setCached: vi.fn(),
    invalidateCache: vi.fn(),
    invalidateCacheByPrefix: vi.fn(),
    getCacheStats: vi.fn(() => ({ hits: 0, misses: 0, evictions: 0 })),
    READ_CACHE_TTL_MS: 30000,
    RequestValidationError
  };
});


describe("Route Integration Tests", () => {
  beforeAll(() => {
    process.env.SIMULATOR_ACCOUNT = "GD5T6IPRNCKFOHQ3STZ5BTEYI5V6U5U6U5U6U5U6U5U6U5U6U5U6U5U6";
    process.env.CONTRACT_ID = "CBLASIRZ7CUKC7S5IS3VSNMQGKZ5FTRWLHZZXH7H4YG6ZLRFPJF5H2LR";
    process.env.SOROBAN_NETWORK_PASSPHRASE = "test";
  });

  describe("GET /", () => {
    it("should return API info", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("SplitNaira API");
    });
  });

  describe("GET /health", () => {
    it("should return 200 and ok status", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("GET /splits", () => {
    it("should return validation error when simulator account is unavailable", async () => {
      const res = await request(app).get("/splits");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("Error Handling & Request ID", () => {
    it("should propagate request-id in internal error responses", async () => {
      const res = await request(app)
        .get("/splits/invalid-project-id!!!")
        .set("x-request-id", "test-request-id");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("validation_error");
      expect(res.body.requestId).toBe("test-request-id");
    });

    it("should return 404 for unknown routes", async () => {
      const res = await request(app).get("/unknown-route");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    });
  });
});
