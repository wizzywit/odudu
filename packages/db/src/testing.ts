// Test-support surface, kept out of the package's main entry point (`.`) so
// that importing it — and the `vitest` dependency it drags in — never reaches
// production code. Consumers add it as a devDependency import:
// `import { expectTenantIsolation } from '@odudu/db/testing'`.
export {
  expectCrossTenantMethodProbe,
  expectTenantIsolation,
  type CrossTenantMethodProbe,
  type TenantProbe,
} from '#/tenant-probe';
