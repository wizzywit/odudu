import type { ReactElement } from 'react';
import { useDiagramId } from '@site/src/shared/lib/use-cases/useDiagramId';
import { DRAWINGS, type DiagramName } from '@site/src/shared/ui/Diagram/diagrams';
import { WIDTH } from '@site/src/shared/lib/services/diagram';
import styles from '@site/src/shared/ui/Diagram/Diagram.module.css';

interface Props {
  name: DiagramName;
  title: string;
  desc: string;
}

// An inline drawing in the site's own colours. The page repeats `desc` as a
// paragraph, which is also what the Markdown copy of the page keeps.
export function Diagram({ name, title, desc }: Props): ReactElement {
  const id = useDiagramId();
  const drawing = DRAWINGS[name];
  const head = `${id}-head`;
  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${String(WIDTH)} ${String(drawing.height)}`}
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        data-diagram={name}
      >
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-desc`}>{desc}</desc>
        <defs>
          <marker
            id={head}
            viewBox="0 0 10 10"
            refX={9}
            refY={5}
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-muted)" />
          </marker>
        </defs>
        {drawing.draw(head)}
      </svg>
    </figure>
  );
}
