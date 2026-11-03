import { DocsLink } from '@site/src/shared/ui/DocsLink/DocsLink';
import type { ReactElement } from 'react';
import { useSignInFlow } from '@site/src/features/landing/use-cases/useSignInFlow';
import { FlowControls } from '@site/src/features/landing/ui/FlowControls/FlowControls';
import { Scene } from '@site/src/features/landing/ui/Scene/Scene';
import styles from '@site/src/features/landing/ui/SignInFlow/SignInFlow.module.css';

// Sign-in as one scene. With no script, or with reduced motion, it is the
// composed picture and the seven captions as a list; where script runs it plays
// once when it comes into view, then loops, and the stepper lets the reader take over.
export function SignInFlow(): ReactElement {
  const flow = useSignInFlow();
  const { uid, stage, step } = flow;
  return (
    <div className={styles.flow} data-flow="" data-step={String(step)}>
      <div className={styles.stage} ref={stage} data-stage="">
        <Scene layout="wide" scene={flow.scenes.wide} step={step} uid={`${uid}-w`} />
        <Scene layout="tall" scene={flow.scenes.tall} step={step} uid={`${uid}-t`} />
      </div>
      <div className={styles.below}>
        <FlowControls
          step={step}
          buttons={flow.buttons}
          playing={flow.wantsPlay}
          running={flow.running}
          holdMs={flow.holdMs}
          label={flow.label}
          live={flow.live}
          leaving={flow.leaving}
          moved={flow.moved}
          handOver={flow.handOver}
          marker={flow.marker}
          widest={flow.widest}
          politeness={flow.politeness}
          onChoose={flow.choose}
          onToggle={flow.toggle}
          onReplay={flow.replay}
        />
        <ol className={styles.captions} data-flow-captions="">
          {flow.captions.map((item) => (
            <li key={item.label}>
              <p className={styles.caption}>{item.caption}</p>
              {item.hasClaims ? (
                <ul className={styles.methods}>
                  {item.claims.map((claim) => (
                    <li key={claim.id} data-claim={claim.id}>
                      {claim.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.more}>
        The ideas are in <DocsLink to="/concepts/sessions/">Sessions</DocsLink> and{' '}
        <DocsLink to="/concepts/tokens/">Tokens</DocsLink>, and{' '}
        <DocsLink to="/guides/sign-a-user-in/">Sign a user in</DocsLink> shows every request.
      </p>
    </div>
  );
}
