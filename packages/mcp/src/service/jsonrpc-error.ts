// The JSON-RPC errors this layer answers with itself, before the SDK has a
// request to serve. The SDK's own codes (-32020 header mismatch, -32022
// unsupported version) are left to it.
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_INTERNAL_ERROR = -32603;
export const JSONRPC_SERVER_ERROR = -32000;
export const JSONRPC_RATE_LIMITED = -32029;

export interface JsonRpcErrorBody {
  readonly jsonrpc: '2.0';
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
  readonly id: null;
}

export function jsonRpcError(code: number, message: string, data?: unknown): JsonRpcErrorBody {
  return {
    jsonrpc: '2.0',
    error: data === undefined ? { code, message } : { code, message, data },
    id: null,
  };
}
