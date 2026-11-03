import type { SigningKey, SigningKeyAlg } from '@odudu/contracts/admin';
import { useState } from 'react';
import { type Area } from '#/entities/area';
import { promotionOf, type Promotion } from '#/entities/signing-key';
import { useRefusal } from '#/entities/session';
import { useKeyLane, type KeyLane } from '#/pages/signing-keys/repository/useKeyLane';
import {
  useDeleteKey,
  usePromoteKey,
  useRetireKey,
  useStageKey,
} from '#/pages/signing-keys/repository/useKeyWrites';
import { keyActionOutcome, type KeyAction } from '#/pages/signing-keys/services/outcome';
import { promotionReading, type PromotionReading } from '#/pages/signing-keys/services/promotion';
import {
  askingOf,
  keyRows,
  shownAlg,
  type Asking,
  type KeyRow,
} from '#/pages/signing-keys/services/rows';
import { KEYS_WORDS, keysArea, type KeysWords } from '#/pages/signing-keys/services/keysWords';
import { algOf, stageFailure, stagedText } from '#/pages/signing-keys/services/stage';
import { useToast } from '#/shared/lib/repository/useToasts';
import { useAnnouncedAction } from '#/shared/lib/use-cases/useAnnouncedAction';
import { useNow } from '#/shared/lib/use-cases/useNow';

// Finer than the minutes a key's readiness is measured in.
const CLOCK_MS = 30_000;

export interface LaneView extends Omit<KeyLane, 'rows'> {
  rows: readonly KeyRow[];
}

// The gate wraps the page, so it takes the area and the title before anything is read.
export function useKeysArea(): { area: Area; title: string } {
  return keysArea();
}

export interface StageSection {
  alg: SigningKeyAlg;
  choose: (value: string) => void;
  busy: boolean;
  start: () => void;
  message: string | null;
  algError: string | undefined;
}

export interface ActionSection {
  asking: Asking | null;
  busy: boolean;
  problem: string | null;
  // What the last action came to, for the line beside the lanes.
  notice: string | null;
  // How many actions have ended in the key's new place, for a view that moves focus once the dialog is gone.
  count: number;
  ask: (action: KeyAction, key: SigningKey) => void;
  cancel: () => void;
  confirm: () => Promise<boolean>;
}

export interface SigningKeysPage {
  title: string;
  words: KeysWords;
  lanes: Record<'rotating' | 'active' | 'retired', LaneView>;
  stage: StageSection;
  action: ActionSection;
}

export function useSigningKeysPage(tenant: string): SigningKeysPage {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const now = useNow(CLOCK_MS);
  const rotating = useKeyLane(tenant, 'rotating');
  const active = useKeyLane(tenant, 'active');
  const retired = useKeyLane(tenant, 'retired');
  const staging = useStageKey(tenant);
  const promote = usePromoteKey(tenant);
  const retire = useRetireKey(tenant);
  const remove = useDeleteKey(tenant);
  const [chosen, setChosen] = useState<SigningKeyAlg | null>(null);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const [stageErrors, setStageErrors] = useState<Partial<Record<string, string>>>({});
  const writes = { promote: promote.run, retire: retire.run, delete: remove.run };
  const acting = useAnnouncedAction<{ action: KeyAction; key: SigningKey }>({
    refusal,
    capability: 'manage-keys',
    blocked: promote.busy || retire.busy || remove.busy,
    send: (asked) => writes[asked.action](asked.key.id),
    outcomeOf: (asked, result) => keyActionOutcome(asked.action, asked.key, result),
  });
  const current = active.rows[0];
  const alg = shownAlg(chosen, current);
  const activeKnown = active.status === 'ready';
  const promotionFor = (key: SigningKey): Promotion =>
    promotionOf(key, active.rows, now, activeKnown);
  const readiness = (key: SigningKey): PromotionReading => promotionReading(promotionFor(key));
  const laneOf = (lane: KeyLane, rotatingRows: boolean): LaneView => ({
    ...lane,
    rows: keyRows(lane.rows, rotatingRows ? readiness : null),
  });
  return {
    title: keysArea().title,
    words: KEYS_WORDS,
    lanes: {
      rotating: laneOf(rotating, true),
      active: laneOf(active, false),
      retired: laneOf(retired, false),
    },
    stage: {
      alg,
      choose: (value) => {
        setChosen(algOf(value));
      },
      busy: staging.busy,
      start: () => {
        setStageMessage(null);
        setStageErrors({});
        staging
          .run(alg)
          .then((result) => {
            if (result.ok) {
              toast.succeeded(stagedText(result.data));
              return;
            }
            const outcome = stageFailure(result);
            setStageMessage(outcome.message);
            setStageErrors(outcome.errors);
            if (outcome.report) refusal.report(result, 'manage-keys');
          })
          .catch(() => undefined);
      },
      message: stageMessage,
      algError: stageErrors.alg,
    },
    action: {
      asking: askingOf(acting.asked, current, promotionFor),
      busy: promote.busy || retire.busy || remove.busy,
      problem: acting.problem,
      notice: acting.notice,
      count: acting.done,
      ask: (action, key) => {
        acting.ask({ action, key });
      },
      cancel: acting.cancel,
      confirm: acting.confirm,
    },
  };
}
