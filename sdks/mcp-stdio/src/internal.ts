// For @odudu/mcp and @odudu/server only, and outside this package's semver
// contract: the pieces the server's own MCP endpoint and its `odudu mcp`
// command run together with the stdio client. It is exported as source, never
// built or published, so a consumer outside this repository cannot import it.

/** @internal */
export {
  ToolProblem,
  type AdminCaller,
  type AdminMethod,
  type AdminRequestSpec,
  type AdminResult,
  type CallableTool,
  type JsonObject,
  type JsonValue,
  type ParseResult,
  type ProblemError,
  type ToolAnnotations,
  type ToolData,
  type ToolResult,
} from '#/services/tool';
/** @internal */
export { accessOf, insufficientScopeProblem, type AdminAccess } from '#/services/admin-access';
/** @internal */
export { expandPattern, INSTANCE_PATTERNS } from '#/services/admin-path';
/** @internal */
export {
  ADMIN_BODY_CAP_BYTES,
  createOnlyOf,
  idempotencyKeyOf,
  IDEMPOTENCY_KEY_PATTERN,
  jsonBodyOf,
  payloadOf,
  preconditionOf,
  preflight,
  REQUEST_BODY_CAP_BYTES,
  RETURNED_HEADERS,
  returnedHeaders,
} from '#/services/admin-request';
/** @internal */
export { ETAG_MAX_LENGTH, ETAG_PATTERN, isEtag } from '#/services/etag-shape';
/** @internal */
export { jsonObjectOf, jsonOf } from '#/services/json-value';
/** @internal */
export {
  cleanData,
  cleanText,
  LONG_TEXT_CAP,
  PROBLEM_DETAIL_CAP,
  PROBLEM_ERROR_TEXT_CAP,
  PROBLEM_ERRORS_MAX,
  PROBLEM_TITLE_CAP,
  PROBLEM_TYPE_CAP,
  TEXT_CAP,
  type CleanOptions,
  type CleanStats,
} from '#/services/sanitize';
/** @internal */
export {
  callTool,
  errorResult,
  problemOf,
  RESULT_CAP,
  runTool,
  type ToolRun,
} from '#/services/call-tool';
/** @internal */
export {
  memoryWriteBudget,
  renewableWriteBudget,
  WRITE_BUDGET,
  type BudgetKind,
  type BudgetLimits,
  type WriteBudget,
} from '#/services/write-budget';
/** @internal */
export {
  announceTenant,
  TENANT_LABEL_CAP,
  type TenantAnnouncement,
} from '#/services/tenant-announcement';
/** @internal */
export {
  callMcpTool,
  type CallMcpToolDeps,
  type RecordedToolCall,
} from '#/use-cases/call-mcp-tool';
/** @internal */
export type { McpLogger } from '#/services/logger';
/** @internal */
export { addressIssuer, domainAddress, pathAddress } from '#/services/address';
/** @internal */
export { stripBidiControls } from '#/services/bidi';
/** @internal */
export {
  ADMIN_API_AUDIENCE,
  MCP_CLIENT_ID,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  SYSTEM_TENANT_NAME,
} from '#/services/scopes';
/** @internal */
export { processMcpIo } from '#/process-io';
/** @internal */
export { runMcp } from '#/run-mcp';
/** @internal */
export type { McpIo } from '#/services/mcp-io';
/** @internal */
export type { RunTool } from '#/services/ports';
/** @internal */
export { MCP_OPTIONS } from '#/services/mcp-options';
/** @internal */
export { loadCatalogue, toolsOf } from '#/adapter/catalogue-file';
/** @internal */
export { createCredentialStore, type CredentialStoreDeps } from '#/adapter/credential-store';
