import { rpc, xdr, ScVal } from "@stellar/stellar-sdk";

export enum ErrorType {
  CONTRACT = "CONTRACT",
  AUTH = "AUTH",
  VALIDATION = "VALIDATION",
  ACCOUNT_STATE = "ACCOUNT_STATE",
  RPC = "RPC",
  INTERNAL = "INTERNAL"
}

export enum ErrorCode {
  // Contract Errors (mapped from SplitError)
  PROJECT_EXISTS = "PROJECT_EXISTS",
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_SPLIT = "INVALID_SPLIT",
  TOO_FEW_COLLABORATORS = "TOO_FEW_COLLABORATORS",
  ZERO_SHARE = "ZERO_SHARE",
  NO_BALANCE = "NO_BALANCE",
  ALREADY_LOCKED = "ALREADY_LOCKED",
  PROJECT_LOCKED = "PROJECT_LOCKED",
  DUPLICATE_COLLABORATOR = "DUPLICATE_COLLABORATOR",
  INVALID_AMOUNT = "INVALID_AMOUNT",
  TOKEN_NOT_ALLOWED = "TOKEN_NOT_ALLOWED",
  ADMIN_NOT_SET = "ADMIN_NOT_SET",
  ARITHMETIC_OVERFLOW = "ARITHMETIC_OVERFLOW",
  INSUFFICIENT_UNALLOCATED = "INSUFFICIENT_UNALLOCATED",
  DISTRIBUTIONS_PAUSED = "DISTRIBUTIONS_PAUSED",

  // Account/Chain State
  ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  CONTRACT_NOT_FOUND = "CONTRACT_NOT_FOUND",

  // System/Other
  VALIDATION_ERROR = "VALIDATION_ERROR",
  SIMULATION_FAILED = "SIMULATION_FAILED",
  RPC_CONNECTIVITY = "RPC_CONNECTIVITY",
  RESOURCE_LIMIT_EXCEEDED = "RESOURCE_LIMIT_EXCEEDED",
  INTERNAL_ERROR = "INTERNAL_ERROR"
}

export interface RemediationHint {
  message: string;
  action?: string;
  docsUrl?: string;
}

export class AppError extends Error {
  constructor(
    public type: ErrorType,
    public code: ErrorCode,
    message: string,
    public remediation?: RemediationHint,
    public details?: any
  ) {
    super(message);
    this.name = "AppError";
  }
}

const CONTRACT_ERROR_MAP: Record<number, { code: ErrorCode; message: string; remediation: RemediationHint }> = {
  1: {
    code: ErrorCode.PROJECT_EXISTS,
    message: "Project ID already exists on-chain",
    remediation: { message: "Choose a unique project ID and try again.", action: "Change Project ID" }
  },
  2: {
    code: ErrorCode.NOT_FOUND,
    message: "Project ID not found",
    remediation: { message: "The requested project does not exist on the network.", action: "Verify ID" }
  },
  3: {
    code: ErrorCode.UNAUTHORIZED,
    message: "Caller is not the project owner",
    remediation: { message: "Only the project owner can perform this action.", action: "Switch Wallet" }
  },
  4: {
    code: ErrorCode.INVALID_SPLIT,
    message: "Basis points do not sum to exactly 10,000",
    remediation: { message: "Ensure all collaborator shares sum to exactly 100%.", action: "Fix Shares" }
  },
  5: {
    code: ErrorCode.TOO_FEW_COLLABORATORS,
    message: "Fewer than 2 collaborators provided",
    remediation: { message: "A split project must have at least 2 collaborators.", action: "Add Collaborator" }
  },
  6: {
    code: ErrorCode.ZERO_SHARE,
    message: "A collaborator was assigned 0 basis points",
    remediation: { message: "Every collaborator must have a non-zero share.", action: "Update Shares" }
  },
  7: {
    code: ErrorCode.NO_BALANCE,
    message: "Target project holds no balance to distribute",
    remediation: { message: "Wait for funds to be deposited before distributing.", action: "Deposit Funds" }
  },
  8: {
    code: ErrorCode.ALREADY_LOCKED,
    message: "Project is already locked",
    remediation: { message: "This project has already been locked and cannot be modified further." }
  },
  9: {
    code: ErrorCode.PROJECT_LOCKED,
    message: "Project is locked; splits cannot be updated",
    remediation: { message: "Locked projects cannot have their collaborator list updated." }
  },
  10: {
    code: ErrorCode.DUPLICATE_COLLABORATOR,
    message: "Duplicate collaborator address detected",
    remediation: { message: "Ensure each collaborator address is unique.", action: "Remove Duplicates" }
  },
  11: {
    code: ErrorCode.INVALID_AMOUNT,
    message: "Amount is invalid",
    remediation: { message: "The provided amount must be positive and within valid ranges.", action: "Check Amount" }
  },
  12: {
    code: ErrorCode.TOKEN_NOT_ALLOWED,
    message: "Token is not in the allowlist",
    remediation: { message: "This contract only supports specific tokens.", action: "Use Allowed Token" }
  },
  13: {
    code: ErrorCode.ADMIN_NOT_SET,
    message: "Contract admin not configured",
    remediation: { message: "The contract is not fully initialized. Contact support.", action: "Contact Support" }
  },
  14: {
    code: ErrorCode.ARITHMETIC_OVERFLOW,
    message: "Calculation overflow occurred",
    remediation: { message: "An internal math error occurred. This may be due to extremely large amounts." }
  },
  15: {
    code: ErrorCode.INSUFFICIENT_UNALLOCATED,
    message: "Insufficient unallocated balance",
    remediation: { message: "Requested withdrawal exceeds the available unallocated funds." }
  },
  16: {
    code: ErrorCode.DISTRIBUTIONS_PAUSED,
    message: "Distributions are paused",
    remediation: { message: "The admin has temporarily paused all distributions.", action: "Try Later" }
  }
};

export function translateSorobanError(err: any): AppError {
  const errorMessage = err?.message || String(err);

  // 1. Handle HTTP/RPC connectivity issues
  if (errorMessage.includes("fetch failed") || errorMessage.includes("ECONNREFUSED") || errorMessage.includes("Network Error")) {
    return new AppError(
      ErrorType.RPC,
      ErrorCode.RPC_CONNECTIVITY,
      "Unable to connect to Soroban RPC",
      { message: "The blockchain node is currently unreachable.", action: "Check Network Status" }
    );
  }

  // 2. Handle Simulation Failures (Host & Contract Errors)
  const simulationResult = err?.simulationResult || err?.response?.results?.[0];
  const rawError = simulationResult?.error || errorMessage;
  
  if (rawError) {
    // Contract errors: Error(Contract, Code(1))
    const contractErrorCodeMatch = rawError.match(/Error\(Contract, Code\((\d+)\)\)/);
    if (contractErrorCodeMatch) {
      const code = parseInt(contractErrorCodeMatch[1], 10);
      const mapped = CONTRACT_ERROR_MAP[code];
      if (mapped) {
        return new AppError(
          ErrorType.CONTRACT,
          mapped.code,
          mapped.message,
          mapped.remediation,
          { rawError }
        );
      }
    }

    // Auth failures: Error(Auth, Code(1))
    if (rawError.includes("Error(Auth,")) {
      return new AppError(
        ErrorType.AUTH,
        ErrorCode.UNAUTHORIZED,
        "Stellar authorization failed",
        { message: "The transaction signature or authorization is invalid.", action: "Re-authenticate Wallet" },
        { rawError }
      );
    }

    // Storage / Missing Contract: Error(Storage, Code(MissingValue))
    if (rawError.includes("Error(Storage, Code(MissingValue))")) {
      return new AppError(
        ErrorType.ACCOUNT_STATE,
        ErrorCode.CONTRACT_NOT_FOUND,
        "Contract or state value not found",
        { message: "The contract or required data is missing from the network.", action: "Verify Deployment" },
        { rawError }
      );
    }

    // Resource limits: Error(Budget, ...)
    if (rawError.includes("Error(Budget,")) {
      return new AppError(
        ErrorType.RPC,
        ErrorCode.RESOURCE_LIMIT_EXCEEDED,
        "Soroban resource limit exceeded",
        { message: "The transaction requires more resources than allowed.", action: "Increase Fees" },
        { rawError }
      );
    }
  }

  // 3. Handle specific account errors
  if (errorMessage.includes("account not found") || errorMessage.includes("op_no_trust")) {
    return new AppError(
      ErrorType.ACCOUNT_STATE,
      ErrorCode.ACCOUNT_NOT_FOUND,
      "Stellar account not found or missing trustline",
      { message: "Ensure your account is funded and has a trustline for the token.", action: "Fund Account" }
    );
  }

  // 4. Handle generic "not found" which might be a project or contract
  if (errorMessage.includes("not found")) {
    return new AppError(
      ErrorType.ACCOUNT_STATE,
      ErrorCode.CONTRACT_NOT_FOUND,
      "Resource not found",
      { message: "The requested resource could not be found on the network.", action: "Check Identifier" },
      { originalError: err }
    );
  }


  // 4. Default Internal Error
  return new AppError(
    ErrorType.INTERNAL,
    ErrorCode.INTERNAL_ERROR,
    errorMessage || "An unexpected error occurred",
    { message: "Our team has been notified. Please try again later." },
    { stack: err.stack, originalError: err }
  );
}

