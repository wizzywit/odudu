// What the server's own MCP endpoint takes from this package so that the two
// run the same code: the request and result types, the admin path and request
// rules, the cleaning of text, the write budget, and the single call of a tool.
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
export { accessOf, insufficientScopeProblem, type AdminAccess } from '#/service/admin-access';
export { expandPattern, INSTANCE_PATTERNS } from '#/service/admin-path';
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
export { ETAG_MAX_LENGTH, ETAG_PATTERN, isEtag } from '#/service/etag-shape';
export { jsonObjectOf, jsonOf } from '#/service/json-value';
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
export {
  callTool,
  errorResult,
  problemOf,
  RESULT_CAP,
  runTool,
  type ToolRun,
} from '#/service/call-tool';
export {
  memoryWriteBudget,
  renewableWriteBudget,
  WRITE_BUDGET,
  type BudgetKind,
  type BudgetLimits,
  type WriteBudget,
} from '#/service/write-budget';
export {
  announceTenant,
  TENANT_LABEL_CAP,
  type TenantAnnouncement,
} from '#/service/tenant-announcement';
export { callMcpTool, type CallMcpToolDeps, type RecordedToolCall } from '#/usecase/call-mcp-tool';
export type { McpLogger } from '#/service/logger';
export { addressIssuer, domainAddress, pathAddress } from '#/service/address';
export { stripBidiControls } from '#/service/bidi';
export {
  ADMIN_API_AUDIENCE,
  MCP_CLIENT_ID,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  SYSTEM_TENANT_NAME,
} from '#/service/scopes';
