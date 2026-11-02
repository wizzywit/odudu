import { beta } from '#/features/beta';
import type { Row } from '#/features/beta/services/row';

export { gamma } from '#/features/gamma/ui/Gamma';

export const load = () => import('#/features/beta/ui/Lazy');
export const own = beta;
export type { Row };
