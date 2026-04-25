import type { SplitProject } from "./stellar";
import { getEnv } from "./env";

const API_BASE_URL = getEnv().NEXT_PUBLIC_API_BASE_URL;
export interface CreateSplitPayload {
  owner: string;
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: Array<{
    address: string;
    alias: string;
    basisPoints: number;
  }>;
}
export interface ProjectHistoryItem {
  id: string;
  type: "round" | "payment";
  round: number;
  amount: string | number;
  recipient: string;
  ledgerCloseTime: number;
  txHash: string;
}
interface BuildSplitResponse {
  xdr: string;
  metadata: {
    networkPassphrase: string;
    contractId: string;
  };
}
export interface RemediationHint {
  message: string;
  action?: string;
  docsUrl?: string;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
  type: string;
  message: string;
  remediation?: RemediationHint;
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: ApiErrorResponse,
    fallback: string
  ) {
    super(payload?.message || fallback);
    this.name = "ApiError";
  }

  get remediation() {
    return this.payload?.remediation;
  }

  get code() {
    return this.payload?.code;
  }
}

async function handleResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as unknown;
  
  if (!response.ok) {
    const errorPayload = body as ApiErrorResponse;
    throw new ApiError(response.status, errorPayload, fallback);
  }
  
  return body as T;
}

export async function buildCreateSplitXdr(payload: CreateSplitPayload): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return handleResponse<BuildSplitResponse>(response, "Failed to build split transaction");
}

export async function buildDistributeXdr(projectId: string, sourceAddress: string): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/distribute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceAddress })
  });
  return handleResponse<BuildSplitResponse>(response, "Failed to build distribution transaction");
}

export async function buildLockProjectXdr(projectId: string, owner: string): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner })
  });
  return handleResponse<BuildSplitResponse>(response, "Failed to build lock transaction");
}

export async function buildDepositXdr(
  projectId: string,
  from: string,
  amount: number
): Promise<BuildSplitResponse> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, amount })
  });
  return handleResponse<BuildSplitResponse>(response, "Failed to build deposit transaction");
}

export async function getSplit(projectId: string): Promise<SplitProject> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}`);
  return handleResponse<SplitProject>(response, "Failed to fetch split project");
}

export async function getProjectHistory(
  projectId: string,
): Promise<ProjectHistoryItem[]> {
  const response = await fetch(`${API_BASE_URL}/splits/${encodeURIComponent(projectId)}/history`);
  return handleResponse<ProjectHistoryItem[]>(response, "Failed to fetch project history");
}