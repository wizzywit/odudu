import type { ReactElement } from 'react';
import type { LayoutName } from '@site/src/features/landing/services/sceneLayouts';
import type { Step } from '@site/src/features/landing/services/signInBeats';
import { buildScene } from '@site/src/features/landing/services/sceneModel';
import '@site/src/features/landing/ui/Scene/travel.css';
import { SceneCheck } from '@site/src/features/landing/ui/SceneCheck/SceneCheck';
import { SceneWindow } from '@site/src/features/landing/ui/SceneWindow/SceneWindow';
import styles from '@site/src/features/landing/ui/Scene/Scene.module.css';

interface Props {
  layout: LayoutName;
  step: Step;
  uid: string;
}

// The sign-in scene at one step, drawn from the model the service builds.
export function Scene({ layout, step, uid }: Props): ReactElement {
  const scene = buildScene(layout, step);
  const { hub } = scene;
  return (
    <svg
      className={styles.scene}
      data-layout={layout}
      viewBox={scene.viewBox}
      role="img"
      aria-labelledby={`scene-title-${uid}`}
      aria-describedby={`scene-desc-${uid}`}
    >
      <title id={`scene-title-${uid}`}>How a person signs in through Odudu</title>
      <desc id={`scene-desc-${uid}`}>
        A person's browser on the left, Odudu in the middle with the ways to sign in, and two apps
        on the right. The browser opens an app, the app sends it to Odudu, Odudu signs the person in
        and sends them back with a signed pass. A second app sends them to Odudu, which recognises
        them and sends them straight back.
      </desc>
      <defs>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0" className={styles.glowCore} />
          <stop offset="0.55" className={styles.glowMid} />
          <stop offset="1" className={styles.glowEdge} />
        </radialGradient>
        {scene.lines.map((line) => (
          <mask
            key={line.id}
            id={`route-${uid}-${line.id}`}
            maskUnits="userSpaceOnUse"
            x={line.mask.x}
            y={line.mask.y}
            width={line.mask.w}
            height={line.mask.h}
          >
            <path
              className={styles.reveal}
              data-on={line.on}
              data-route-reveal={line.id}
              d={line.d}
              pathLength={1}
              style={{ transitionDelay: `${String(line.delay)}ms` }}
            />
          </mask>
        ))}
      </defs>

      <circle cx={scene.glow.cx} cy={scene.glow.cy} r={scene.glow.r} fill={`url(#glow-${uid})`} />
      {scene.rings.map((ring) => (
        <circle
          key={ring.r}
          className={styles.ring}
          data-pulse={ring.pulse}
          style={{ animationDelay: `${String(ring.delay)}ms` }}
          cx={scene.glow.cx}
          cy={scene.glow.cy}
          r={ring.r}
        />
      ))}

      {scene.lines.map((line) => (
        <g key={line.id}>
          <path className={styles.route} d={line.d} />
          <path
            className={styles.routeOn}
            data-on={line.on}
            d={line.d}
            mask={`url(#route-${uid}-${line.id})`}
          />
        </g>
      ))}
      {scene.heads.map((head) => (
        <g key={`head-${head.id}`} transform={head.at}>
          <path
            className={styles.head}
            data-on={head.lit}
            style={{ transitionDelay: `${String(head.delay)}ms` }}
            d="M-10 -6L0 0L-10 6z"
          />
          <path
            className={styles.headOn}
            data-on={head.lit}
            style={{ transitionDelay: `${String(head.delay)}ms` }}
            d="M-10 -6L0 0L-10 6z"
          />
        </g>
      ))}

      <g className={styles.node} data-on={scene.device.on}>
        <SceneWindow window={scene.device} />
      </g>
      <g className={styles.node} data-on={scene.appA.on}>
        <SceneWindow window={scene.appA} />
      </g>
      <g className={styles.late} data-away={scene.bAway}>
        <g className={styles.node} data-on={scene.appB.on}>
          <SceneWindow window={scene.appB} />
        </g>
      </g>

      <g className={styles.node} data-on={hub.on} data-told={hub.told}>
        <rect
          className={styles.halo}
          data-on={hub.on}
          x={hub.halo.x}
          y={hub.halo.y}
          width={hub.halo.w}
          height={hub.halo.h}
          rx={28}
        />
        <rect
          className={styles.hub}
          x={hub.card.x}
          y={hub.card.y}
          width={hub.card.w}
          height={hub.card.h}
          rx={22}
        />
        <rect
          className={styles.sheen}
          x={hub.sheen.x}
          y={hub.sheen.y}
          width={hub.sheen.w}
          height={hub.sheen.h}
          rx={21}
        />
        <g className={styles.staff} transform={hub.staff}>
          <circle cx={0} cy={0} r={4} />
          <path d="M0 4V26M-4 8H4" />
        </g>
        <g className={styles.signed} data-on={hub.check.on}>
          <SceneCheck check={hub.check} />
        </g>
        <text className={styles.hubName} x={hub.nameAt[0]} y={hub.nameAt[1]}>
          Odudu
        </text>
        {hub.chips.map((chip) => (
          <g key={chip.label} data-claim-chip={chip.claim}>
            <rect
              className={styles.chip}
              x={chip.x}
              y={chip.y}
              width={chip.width}
              height={30}
              rx={15}
            />
            <rect
              className={styles.chipOn}
              data-lit={chip.lit}
              style={{ animationDelay: `${String(chip.delay)}ms` }}
              x={chip.x}
              y={chip.y}
              width={chip.width}
              height={30}
              rx={15}
            />
            <text className={styles.chipText} x={chip.textAt[0]} y={chip.textAt[1]}>
              {chip.label}
            </text>
          </g>
        ))}
      </g>

      <g key={`flow-${String(step)}`}>
        {scene.dots.map((dot) => (
          <circle
            key={dot.key}
            className={styles.dot}
            cx={dot.at[0]}
            cy={dot.at[1]}
            r={3.6}
            style={{ animationName: dot.name, animationDelay: `${String(dot.delay)}ms` }}
          />
        ))}
        {scene.tickets.map((ticket) => (
          <g
            key="ticket"
            transform={`translate(${String(ticket.start[0])} ${String(ticket.start[1])})`}
          >
            <g
              className={styles.ticket}
              style={{
                animationName: ticket.name,
                animationDelay: `${String(ticket.delay)}ms`,
              }}
            >
              <rect className={styles.pass} x={-30} y={-13} width={60} height={26} rx={13} />
              <path className={styles.checkLine} d="M-13 0L-6 6L8 -6" />
              <path className={styles.tick} d="M14 -4H22M14 3H20" />
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
