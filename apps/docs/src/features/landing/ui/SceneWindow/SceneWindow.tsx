import type { ReactElement } from 'react';
import type { WindowModel } from '@site/src/features/landing/services/scene';
import { SceneCheck } from '@site/src/features/landing/ui/SceneCheck/SceneCheck';
import styles from '@site/src/features/landing/ui/SceneWindow/SceneWindow.module.css';

// The shapes a skeleton can be made of, each with the class that paints it.
const LOOKS = {
  bar: styles.bar,
  field: styles.field,
  cta: styles.cta,
  avatar: styles.avatar,
  block: styles.block,
} as const;

interface Props {
  window: WindowModel;
}

// A window of the scene: its halo, frame, title bar and a skeleton of what it shows.
export function SceneWindow({ window }: Props): ReactElement {
  const { halo, frame, signs } = window;
  return (
    <>
      <rect
        className={styles.halo}
        data-on={window.on}
        x={halo.x}
        y={halo.y}
        width={halo.w}
        height={halo.h}
        rx={20}
      />
      <rect
        className={styles.window}
        data-away={window.away}
        x={frame.x}
        y={frame.y}
        width={frame.w}
        height={frame.h}
        rx={16}
      />
      <path className={styles.rule} d={window.rule} />
      {window.lamps.map(([x, y]) => (
        <circle key={x} className={styles.lamp} cx={x} cy={y} r={3.2} />
      ))}
      <text className={styles.tag} x={window.labelAt[0]} y={window.labelAt[1]}>
        {window.label}
      </text>
      {window.shapes.map((shape) =>
        shape.round ? (
          <circle
            key={`${shape.look}-${String(shape.x)}-${String(shape.y)}`}
            className={LOOKS[shape.look]}
            cx={shape.x}
            cy={shape.y}
            r={shape.radius}
          />
        ) : (
          <rect
            key={`${shape.look}-${String(shape.x)}-${String(shape.y)}`}
            className={LOOKS[shape.look]}
            x={shape.x}
            y={shape.y}
            width={shape.width}
            height={shape.height}
            rx={shape.radius}
          />
        ),
      )}
      {signs.map((signed) => (
        <g key="signed" className={styles.signed} data-on={signed.on}>
          <SceneCheck check={signed} />
        </g>
      ))}
    </>
  );
}
