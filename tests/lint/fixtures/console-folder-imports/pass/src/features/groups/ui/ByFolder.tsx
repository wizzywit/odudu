import { session } from '#/features/audit';
import { Button } from '#/shared/ui/Button';
import styles from '#/features/groups/ui/Tab.module.css';
import { here } from '#/features/groups/use-cases/useHere';

export const shown = [Button, session, styles, here];
