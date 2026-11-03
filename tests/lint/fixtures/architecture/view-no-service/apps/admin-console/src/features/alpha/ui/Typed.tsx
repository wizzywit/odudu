import type { Row } from '#/features/alpha/services/row';
import { type Cell, type Kind } from '#/features/alpha/services/cell';
import { Button } from '#/shared/ui/Button';

export const typed = (row: Row, cell: Cell, kind: Kind) => [row, cell, kind, Button];
