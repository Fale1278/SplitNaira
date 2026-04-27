import { describe, expect, it } from "vitest";
import { ErrorCode, ErrorType, translateSorobanError } from "./errors.js";

describe("translateSorobanError", () => {
  it("maps contract error codes correctly", () => {
    const rawError = "HostError: Error(Contract, Code(1))";
    const appError = translateSorobanError({ message: rawError });
    
    expect(appError.type).toBe(ErrorType.CONTRACT);
    expect(appError.code).toBe(ErrorCode.PROJECT_EXISTS);
    expect(appError.remediation?.action).toBe("Change Project ID");
  });

  it("maps auth failures correctly", () => {
    const rawError = "HostError: Error(Auth, Code(InvalidAction))";
    const appError = translateSorobanError({ message: rawError });
    
    expect(appError.type).toBe(ErrorType.AUTH);
    expect(appError.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(appError.remediation?.message).toContain("signature or authorization is invalid");
  });

  it("maps missing contract/storage failures correctly", () => {
    const rawError = "HostError: Error(Storage, Code(MissingValue))";
    const appError = translateSorobanError({ message: rawError });
    
    expect(appError.type).toBe(ErrorType.ACCOUNT_STATE);
    expect(appError.code).toBe(ErrorCode.CONTRACT_NOT_FOUND);
  });

  it("maps resource limit failures correctly", () => {
    const rawError = "HostError: Error(Budget, Code(ExceededLimit))";
    const appError = translateSorobanError({ message: rawError });
    
    expect(appError.type).toBe(ErrorType.RPC);
    expect(appError.code).toBe(ErrorCode.RESOURCE_LIMIT_EXCEEDED);
  });

  it("handles RPC connectivity errors", () => {
    const err = new Error("fetch failed");
    const appError = translateSorobanError(err);
    
    expect(appError.type).toBe(ErrorType.RPC);
    expect(appError.code).toBe(ErrorCode.RPC_CONNECTIVITY);
  });

  it("handles account not found errors", () => {
    const appError = translateSorobanError({ message: "account not found" });
    
    expect(appError.type).toBe(ErrorType.ACCOUNT_STATE);
    expect(appError.code).toBe(ErrorCode.ACCOUNT_NOT_FOUND);
  });

  it("handles simulation results in object format", () => {
    const err = {
      simulationResult: {
        error: "HostError: Error(Contract, Code(2))"
      }
    };
    const appError = translateSorobanError(err);
    
    expect(appError.type).toBe(ErrorType.CONTRACT);
    expect(appError.code).toBe(ErrorCode.NOT_FOUND);
  });

  it("falls back to internal error for unknown failures", () => {
    const appError = translateSorobanError("something went horribly wrong");
    
    expect(appError.type).toBe(ErrorType.INTERNAL);
    expect(appError.code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
