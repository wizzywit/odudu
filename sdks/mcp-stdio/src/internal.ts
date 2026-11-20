// For @odudu/mcp only, and outside this package's semver contract: the pieces the
// server's own MCP endpoint runs together with the stdio client. It is exported
// as source, never built or published, so a consumer outside this repository
// cannot import it.

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
} from '#/service/tool';
/** @internal */
export { accessOf, insufficientScopeProblem, type AdminAccess } from '#/service/admin-access';
/** @internal */
export { expandPattern, INSTANCE_PATTERNS } from '#/service/admin-path';
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
} from '#/service/admin-request';
/** @internal */
export { ETAG_MAX_LENGTH, ETAG_PATTERN, isEtag } from '#/service/etag-shape';
/** @internal */
export { jsonObjectOf, jsonOf } from '#/service/json-value';
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
} from '#/service/sanitize';
/** @internal */
export {
  callTool,
  errorResult,
  problemOf,
  RESULT_CAP,
  runTool,
  type ToolRun,
} from '#/service/call-tool';
/** @internal */
export {
  memoryWriteBudget,
  renewableWriteBudget,
  WRITE_BUDGET,
  type BudgetKind,
  type BudgetLimits,
  type WriteBudget,
} from '#/service/write-budget';
/** @internal */
export {
  announceTenant,
  TENANT_LABEL_CAP,
  type TenantAnnouncement,
} from '#/service/tenant-announcement';
/** @internal */
export { callMcpTool, type CallMcpToolDeps, type RecordedToolCall } from '#/usecase/call-mcp-tool';
/** @internal */
export type { McpLogger } from '#/service/logger';
/** @internal */
export { addressIssuer, domainAddress, pathAddress } from '#/service/address';
/** @internal */
export { stripBidiControls } from '#/service/bidi';
/** @internal */
export {
  ADMIN_API_AUDIENCE,
  MCP_CLIENT_ID,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  SYSTEM_TENANT_NAME,
} from '#/service/scopes';
