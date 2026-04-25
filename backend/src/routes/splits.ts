import { Request, Response, NextFunction, Router } from "express";
import { z } from "zod";
import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";

import { 
  loadStellarConfig, 
  getStellarRpcServer, 
  RequestValidationError 
} from "../services/stellar.js";

import { 
  AppError, 
  ErrorCode, 
  ErrorType, 
  translateSorobanError 
} from "../lib/errors.js";

function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}

export const splitsRouter = Router();

// Strict Stellar address validator used across schemas
const stellarAddressSchema = z
  .string()
  .min(1, "address is required")
  .superRefine((value, ctx) => {
    try {
      Address.fromString(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a valid Stellar address (classic or contract)"
      });
    }
  });

const collaboratorSchema = z.object({
  address: stellarAddressSchema,
  alias: z.string().min(1, "alias is required").max(64),
  basisPoints: z
    .number()
    .int("basisPoints must be an integer")
    .positive("basisPoints must be greater than 0")
    .max(10_000, "basisPoints must be <= 10000")
});

const createSplitSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    projectId: z
      .string()
      .min(1, "projectId is required")
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore"),
    title: z.string().min(1, "title is required").max(128),
    projectType: z.string().min(1, "projectType is required").max(32),
    token: stellarAddressSchema.describe("token"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

const projectIdParamSchema = z
  .string()
  .min(1, "projectId is required")
  .max(32, "projectId must be at most 32 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "projectId must be alphanumeric/underscore");

const lockProjectSchema = z.object({
  owner: stellarAddressSchema.describe("owner")
});

const depositSchema = z.object({
  from: stellarAddressSchema.describe("from"),
  amount: z
    .number()
    .positive("amount must be greater than 0")
    .describe("deposit amount in stroops")
});

const updateCollaboratorsSchema = z
  .object({
    owner: stellarAddressSchema.describe("owner"),
    collaborators: z.array(collaboratorSchema).min(2, "at least 2 collaborators are required")
  })
  .superRefine((payload, ctx) => {
    const totalBasisPoints = payload.collaborators.reduce(
      (sum, collaborator) => sum + collaborator.basisPoints,
      0
    );
    if (totalBasisPoints !== 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collaborators"],
        message: "collaborators basisPoints must sum to exactly 10000"
      });
    }

    const addresses = new Set<string>();
    for (const collaborator of payload.collaborators) {
      if (addresses.has(collaborator.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collaborators"],
          message: "duplicate collaborator address found"
        });
        break;
      }
      addresses.add(collaborator.address);
    }
  });

const adminTokenSchema = z.object({
  admin: stellarAddressSchema.describe("admin"),
  token: stellarAddressSchema.describe("token")
});

function toCollaboratorScVal(collaborator: z.infer<typeof collaboratorSchema>) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: nativeToScVal("address", { type: "symbol" }),
      val: Address.fromString(collaborator.address).toScVal()
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal("alias", { type: "symbol" }),
      val: nativeToScVal(collaborator.alias)
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal("basis_points", { type: "symbol" }),
      val: xdr.ScVal.scvU32(collaborator.basisPoints)
    })
  ]);
}

async function buildCreateProjectUnsignedXdr(
  input: z.infer<typeof createSplitSchema>
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.owner);
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let ownerAddress: Address;
  let tokenAddress: Address;
  try {
    ownerAddress = Address.fromString(input.owner);
    tokenAddress = Address.fromString(input.token);
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  let collaboratorScVals: xdr.ScVal[];
  try {
    collaboratorScVals = input.collaborators.map((collaborator) =>
      toCollaboratorScVal(collaborator)
    );
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "create_project",
        ownerAddress.toScVal(),
        nativeToScVal(input.projectId, { type: "symbol" }),
        nativeToScVal(input.title),
        nativeToScVal(input.projectType),
        tokenAddress.toScVal(),
        xdr.ScVal.scvVec(collaboratorScVals)
      )
    )
    .setTimeout(300)
    .build();

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }

  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "create_project"
    }
  };
}

async function listProjects(start: number, limit: number) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(config.simulatorAccount);
  } catch {
    throw new RequestValidationError("simulator account not found on selected network");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call("list_projects", xdr.ScVal.scvU32(start), xdr.ScVal.scvU32(limit))
    )
    .setTimeout(300)
    .build();

  let simulated;
  try {
    simulated = await server.simulateTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return [];
  }

  return scValToNative(retval) as unknown[];
}

async function fetchProjectById(projectId: string) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(config.simulatorAccount);
  } catch {
    throw new RequestValidationError("simulator account not found on selected network");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(contract.call("get_project", nativeToScVal(projectId, { type: "symbol" })))
    .setTimeout(300)
    .build();

  let simulated;
  try {
    simulated = await server.simulateTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  const retval = "result" in simulated ? simulated.result?.retval : undefined;
  if (!retval) {
    return null;
  }

  const project = scValToNative(retval) as unknown;
  return project ?? null;
}

interface LockProjectRequest {
  projectId: string;
  owner: string;
}

async function buildLockProjectUnsignedXdr(input: LockProjectRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.owner);
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let ownerAddress: Address;
  try {
    ownerAddress = Address.fromString(input.owner);
  } catch {
    throw new RequestValidationError("owner address must be a valid Stellar address");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "lock_project",
        nativeToScVal(input.projectId, { type: "symbol" }),
        ownerAddress.toScVal()
      )
    )
    .setTimeout(300)
    .build();

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "lock_project"
    }
  };
}

interface DepositRequest {
  projectId: string;
  from: string;
  amount: number;
}

async function buildDepositUnsignedXdr(input: DepositRequest) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.from);
  } catch {
    throw new RequestValidationError("from account not found on selected network");
  }

  let fromAddress: Address;
  try {
    fromAddress = Address.fromString(input.from);
  } catch {
    throw new RequestValidationError("from address must be a valid Stellar address");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "deposit",
        nativeToScVal(input.projectId, { type: "symbol" }),
        fromAddress.toScVal(),
        nativeToScVal(input.amount, { type: "i128" })
      )
    )
    .setTimeout(300)
    .build();

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.from,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "deposit"
    }
  };
}

interface UpdateCollaboratorsRequest {
  projectId: string;
  owner: string;
  collaborators: Array<z.infer<typeof collaboratorSchema>>;
}

async function buildUpdateCollaboratorsUnsignedXdr(
  input: UpdateCollaboratorsRequest
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let sourceAccount;
  try {
    sourceAccount = await server.getAccount(input.owner);
  } catch {
    throw new RequestValidationError("owner account not found on selected network");
  }

  let ownerAddress: Address;
  let collaboratorScVals: xdr.ScVal[];
  try {
    ownerAddress = Address.fromString(input.owner);
    collaboratorScVals = input.collaborators.map((collaborator) =>
      toCollaboratorScVal(collaborator)
    );
  } catch {
    throw new RequestValidationError("owner/token/collaborator addresses must be valid Stellar addresses");
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        "update_collaborators",
        nativeToScVal(input.projectId, { type: "symbol" }),
        ownerAddress.toScVal(),
        xdr.ScVal.scvVec(collaboratorScVals)
      )
    )
    .setTimeout(300)
    .build();

  let preparedTx;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (error) {
    throw translateSorobanError(error);
  }
  return {
    xdr: preparedTx.toXDR(),
    metadata: {
      contractId: config.contractId,
      networkPassphrase: config.networkPassphrase,
      sourceAccount: input.owner,
      sequenceNumber: preparedTx.sequence,
      fee: preparedTx.fee,
      operation: "update_collaborators"
    }
  };
}

const listProjectsSchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

splitsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;

    const parsed = listProjectsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const projects = await listProjects(parsed.data.start, parsed.data.limit);
    return res.status(200).json(serializeBigInts(projects));
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const project = await fetchProjectById(projectId);
    if (!project) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        `Split project ${projectId} not found.`
      );
    }

    return res.status(200).json(serializeBigInts(project));
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/lock", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = lockProjectSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check owner address." }
      );
    }

    try {
      const result = await buildLockProjectUnsignedXdr({
        projectId: projectId,
        owner: parsedBody.data.owner
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/:projectId/deposit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = depositSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check deposit details." }
      );
    }

    try {
      const result = await buildDepositUnsignedXdr({
        projectId: projectId,
        from: parsedBody.data.from,
        amount: parsedBody.data.amount
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.put("/:projectId/collaborators", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedBody = updateCollaboratorsSchema.safeParse(req.body);

    if (!parsedBody.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check collaborator list." }
      );
    }

    try {
      const result = await buildUpdateCollaboratorsUnsignedXdr({
        projectId: projectId,
        owner: parsedBody.data.owner,
        collaborators: parsedBody.data.collaborators
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/", async (req, res, next) => {
  try {
    const requestId = res.locals.requestId;
    const parsed = createSplitSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        { message: "Check the provided project details." }
      );
    }

    try {
      const result = await buildCreateProjectUnsignedXdr(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof RequestValidationError) {
        throw new AppError(ErrorType.VALIDATION, ErrorCode.VALIDATION_ERROR, error.message);
      }
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

const distributeSchema = z.object({
  sourceAddress: z.string().min(1, "sourceAddress is required").optional()
});

splitsRouter.post("/:projectId/distribute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsed = distributeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "Invalid request payload.",
        { message: "Check the distribution request body." }
      );
    }

    const config = loadStellarConfig();
    const server = getStellarRpcServer();

    let sourceAccount;
    const sourceAddress = parsed.data?.sourceAddress || config.simulatorAccount;
    try {
      sourceAccount = await server.getAccount(sourceAddress);
    } catch {
      throw new AppError(
        ErrorType.ACCOUNT_STATE,
        ErrorCode.ACCOUNT_NOT_FOUND,
        "Source account not found on selected network",
        { message: "The account used to trigger distribution must exist and be funded.", action: "Check Source Wallet" }
      );
    }
    
    let preparedTx;
    try {
      const contract = new Contract(config.contractId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase
      })
        .addOperation(
          contract.call("distribute", nativeToScVal(projectId, { type: "symbol" }))
        )
        .setTimeout(300)
        .build();

      preparedTx = await server.prepareTransaction(tx);
    } catch (error) {
      throw translateSorobanError(error);
    }

    return res.status(200).json({
      xdr: preparedTx.toXDR(),
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: sourceAddress,
        operation: "distribute"
      }
    });
  } catch (error) {
    return next(error);
  }
});

splitsRouter.get("/:projectId/claimable/:address", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;
    const { address } = req.params;

    if (!address) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "address is required"
      );
    }

    const config = loadStellarConfig();
    const server = new rpc.Server(config.sorobanRpcUrl, { allowHttp: true });

    let sourceAccount;
    try {
      sourceAccount = await server.getAccount(config.simulatorAccount);
    } catch {
      throw new AppError(
        ErrorType.ACCOUNT_STATE,
        ErrorCode.ACCOUNT_NOT_FOUND,
        "Simulator account not found",
        { message: "The backend simulator account is not configured correctly." }
      );
    }

    let simulated;
    try {
      const contract = new Contract(config.contractId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase
      })
        .addOperation(
          contract.call(
            "get_claimable",
            nativeToScVal(projectId, { type: "symbol" }),
            Address.fromString(address).toScVal()
          )
        )
        .setTimeout(300)
        .build();

      simulated = await server.simulateTransaction(tx);
    } catch (error) {
      throw translateSorobanError(error);
    }
    const retval = "result" in simulated ? simulated.result?.retval : undefined;
    if (!retval) {
      throw new AppError(
        ErrorType.RPC,
        ErrorCode.NOT_FOUND,
        "Claimable info not found"
      );
    }

    return res.status(200).json(serializeBigInts(scValToNative(retval)));
  } catch (error) {
    return next(error);
  }
});

const historyQuerySchema = z.object({
  cursor: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

splitsRouter.get("/:projectId/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = res.locals.requestId;
    const parsedId = projectIdParamSchema.safeParse(req.params.projectId);
    if (!parsedId.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid projectId format.",
        undefined,
        parsedId.error.flatten()
      );
    }
    const projectId = parsedId.data;

    const parsedQuery = historyQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw new AppError(
        ErrorType.VALIDATION, 
        ErrorCode.VALIDATION_ERROR, 
        "Invalid query parameters.",
        { message: "Check cursor and limit parameters." }
      );
    }
    const { cursor, limit } = parsedQuery.data;

    const config = loadStellarConfig();
    const server = getStellarRpcServer();

    const topicProjectId = nativeToScVal(projectId, { type: "symbol" }).toXDR("base64");
    const roundTopic = nativeToScVal("distribution_complete", { type: "symbol" }).toXDR("base64");
    const paymentTopic = nativeToScVal("payment_sent", { type: "symbol" }).toXDR("base64");

    const roundEventResponse = await server.getEvents({
      cursor,
      filters: [
        {
          type: "contract",
          contractIds: [config.contractId],
          topics: [[roundTopic], [topicProjectId]]
        }
      ],
      limit
    });

    const paymentEventResponse = await server.getEvents({
      cursor,
      filters: [
        {
          type: "contract",
          contractIds: [config.contractId],
          topics: [[paymentTopic], [topicProjectId]]
        }
      ],
      limit
    });

    const events = [
      ...roundEventResponse.events.map((e) => {
        const data = scValToNative(e.value) as [number, string | number | bigint];
        return {
          type: "round",
          round: data[0],
          amount: String(data[1]),
          txHash: e.txHash,
          ledgerCloseTime: e.ledgerClosedAt,
          id: e.id
        };
      }),
      ...paymentEventResponse.events.map((e) => {
        const data = scValToNative(e.value) as [string, string | number | bigint];
        return {
          type: "payment",
          recipient: data[0],
          amount: String(data[1]),
          txHash: e.txHash,
          ledgerCloseTime: e.ledgerClosedAt,
          id: e.id
        };
      })
    ].sort((a, b) => b.ledgerCloseTime.localeCompare(a.ledgerCloseTime));

    // Prefer the server-provided pagination cursor when available
    const nextCursor =
      // soroban-rpc getEvents commonly returns `cursor` for pagination
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((roundEventResponse as any)?.cursor as string | undefined) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((paymentEventResponse as any)?.cursor as string | undefined) ||
      null;

    return res.status(200).json(serializeBigInts(events));
  } catch (error) {
    return next(error);
  }
});

async function buildAdminTokenXdr(
  operation: "allow_token" | "disallow_token",
  input: z.infer<typeof adminTokenSchema>
) {
  const config = loadStellarConfig();
  const server = getStellarRpcServer();

  let adminAccount;
  try {
    adminAccount = await server.getAccount(input.admin);
  } catch {
    throw new AppError(
      ErrorType.VALIDATION,
      ErrorCode.VALIDATION_ERROR,
      "admin account not found on selected network"
    );
  }

  const contract = new Contract(config.contractId);
  const tx = new TransactionBuilder(adminAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      contract.call(
        operation,
        new Address(input.admin).toScVal(),
        new Address(input.token).toScVal()
      )
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

splitsRouter.post("/admin/allow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const xdr = await buildAdminTokenXdr("allow_token", parsed.data);
    const config = loadStellarConfig();

    return res.status(200).json({
      xdr,
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: parsed.data.admin,
        operation: "allow_token"
      }
    });
  } catch (error) {
    return next(error);
  }
});

splitsRouter.post("/admin/disallow-token", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = adminTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        ErrorType.VALIDATION,
        ErrorCode.VALIDATION_ERROR,
        "Invalid request payload.",
        undefined,
        parsed.error.flatten()
      );
    }

    const xdr = await buildAdminTokenXdr("disallow_token", parsed.data);
    const config = loadStellarConfig();

    return res.status(200).json({
      xdr,
      metadata: {
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        sourceAccount: parsed.data.admin,
        operation: "disallow_token"
      }
    });
  } catch (error) {
    return next(error);
  }
});