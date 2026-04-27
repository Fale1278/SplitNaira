import { describe, it, expect } from "vitest";
import { translateSorobanError, ErrorCode, ErrorType } from "../lib/errors.js";

describe("Error Translation Layer", () => {
  it("should map contract error Code(1) to PROJECT_EXISTS", () => {
    const mockError = {
      simulationResult: {
        error: "HostError: Error(Contract, Code(1))"
      }
    };
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.PROJECT_EXISTS);
    expect(translated.type).toBe(ErrorType.CONTRACT);
    expect(translated.remediation?.message).toContain("unique project ID");
  });

  it("should map contract error Code(3) to UNAUTHORIZED", () => {
    const mockError = {
      simulationResult: {
        error: "HostError: Error(Contract, Code(3))"
      }
    };
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(translated.remediation?.action).toBe("Switch Wallet");
  });

  it("should handle connectivity errors", () => {
    const mockError = new Error("fetch failed");
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.RPC_CONNECTIVITY);
    expect(translated.type).toBe(ErrorType.RPC);
  });

  it("should handle account not found errors", () => {
    const mockError = new Error("account not found");
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.ACCOUNT_NOT_FOUND);
    expect(translated.type).toBe(ErrorType.ACCOUNT_STATE);
  });

  it("should provide a fallback for unknown simulation failures", () => {
    const mockError = {
      simulationResult: {
        error: "Some weird host error"
      }
    };
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.SIMULATION_FAILED);
    expect(translated.type).toBe(ErrorType.RPC);
  });

  it("should provide a fallback for internal errors", () => {
    const mockError = new Error("Unexpected crash");
    const translated = translateSorobanError(mockError);
    expect(translated.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(translated.type).toBe(ErrorType.INTERNAL);
  });
});
