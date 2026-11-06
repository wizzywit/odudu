export { challengeFor, insufficientScope } from '#/service/challenge';
export { mcpResourceUrl, resourceMetadataUrl, RESOURCE_METADATA_SUFFIX } from '#/service/resource';
export {
  registerResourceMetadataRoute,
  RESOURCE_METADATA_PATH_FORM,
  RESOURCE_METADATA_DOMAIN_FORM,
} from '#/view/routes/resource-metadata';
export { createInProcessCaller, ADMIN_BODY_CAP_BYTES } from '#/adapter/in-process-caller';
export type { InProcessCallerDeps } from '#/adapter/in-process-caller';
export { exchangeForAdmin } from '#/usecase/exchange';
export { scopeFor, type AdminAccess } from '#/service/admin-access';
export { newRequestScope, type AdminBearer, type RequestScope } from '#/service/request-scope';
export type { McpCallDeps, McpDeps, McpLogger } from '#/service/deps';
export type { ValidatedMcpToken } from '#/service/validated-token';
export type { AdminCaller, AdminRequestSpec, AdminResult } from '#/service/tool';
