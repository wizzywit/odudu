export { KERNEL_VERSION } from '#/version.js';
export { OduduError, type ErrorCode } from '#/errors.js';
export { type Clock, systemClock, FakeClock } from '#/clock.js';
export { newId } from '#/ids.js';
export { type Config, loadConfig } from '#/config.js';
export { type Logger } from '#/logger.js';
export { ModuleRegistry, type ModuleContext, type OduduModule } from '#/registry.js';
