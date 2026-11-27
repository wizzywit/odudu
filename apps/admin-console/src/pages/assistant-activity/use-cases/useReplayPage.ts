import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { subjectHref, subjectLinkOf } from '#/entities/subject';
import {
  useCaseExport,
  useReplay,
  useReport,
} from '#/pages/assistant-activity/repository/useAssistantActivity';
import { activityHref } from '#/pages/assistant-activity/services/addresses';
import {
  ANSWERS,
  APPROVAL_COLUMNS,
  ASKED,
  FACTS,
  NOTHING,
  SHOWN_IN_PART,
  openSubject,
  BACK_LABEL,
  CHANGES,
  DECISIONS,
  EXPORT_EXPLAINED,
  EXPORT_LABEL,
  HIDE_TURN,
  MORE_EVENTS,
  EVENTS_NOT_SHOWN,
  NOT_ENDED,
  NO_CHANGES,
  REPLAY_FAILED,
  REPLAY_LOADING,
  REPLAY_TITLE,
  REPORTED_LABEL,
  REPORT_EXPLAINED,
  SHOW_TURN,
  STEPS,
  TURNS_OMITTED,
  WHY_MODEL,
  WHY_STOPPED,
  WITHHELD_NOTE,
} from '#/pages/assistant-activity/services/activityText';
import { exportFailureText, caseSavedText } from '#/pages/assistant-activity/services/exportCase';
import {
  IDLE,
  reportHeld,
  reportLabel,
  reportLine,
  reportStateOf,
} from '#/pages/assistant-activity/services/report';
import { turnView, type TurnView } from '#/pages/assistant-activity/services/replayView';
import {
  isOpen,
  limitOf,
  moreShown,
  toggled,
  type Opened,
  type Shown,
} from '#/pages/assistant-activity/services/turnState';
import { approvalTone, stopTone } from '#/pages/assistant-activity/services/outcome';
import type { Replay } from '#/pages/assistant-activity/types/activity';
import { holds } from '#/shared/lib/services/access';
import type { Read } from '#/shared/lib/services/read';
import { useToast } from '#/shared/lib/repository/useToasts';

export interface ReplayPage {
  read: Read<Replay>;
  backHref: string;
  personLink: ((id: string) => string) | null;
  // The answers of a replay as they are drawn, the latest open.
  turns: (replay: Replay) => readonly TurnView[];
  toggle: (turn: TurnView) => void;
  showMore: (turn: TurnView) => void;
  report: {
    label: (replay: Replay) => string;
    explained: string;
    held: (replay: Replay) => boolean;
    busy: boolean;
    line: string | null;
    run: () => void;
  };
  export: { label: string; explained: string; busy: boolean; run: () => void };
  words: {
    title: string;
    back: string;
    failed: string;
    loading: string;
    withheld: string;
    asked: string;
    changes: string;
    noChanges: string;
    steps: string;
    decisions: string;
    whyModel: string;
    whyStopped: string;
    notEnded: string;
    show: string;
    hide: string;
    more: (count: number) => string;
    notShown: (count: number) => string;
    omitted: (count: number) => string;
    answers: string;
    nothing: string;
    inPart: string;
    facts: typeof FACTS;
    approvalColumns: typeof APPROVAL_COLUMNS;
    openSubject: typeof openSubject;
  };
  tone: typeof stopTone;
  approvalTone: typeof approvalTone;
}

export function useReplayPage(tenant: string, id: string): ReplayPage {
  const authority = useAuthority(tenant);
  const toast = useToast();
  const read = useReplay(tenant, id);
  const reporting = useReport(tenant, id);
  const exporting = useCaseExport(tenant, id);
  const [reported, setReported] = useState(IDLE);
  const [opened, setOpened] = useState<Opened>({});
  const [shown, setShown] = useState<Shown>({});
  const latest = (replay: Replay): string | undefined => replay.turns.at(-1)?.id;
  return {
    read,
    backHref: activityHref(tenant),
    personLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    turns: (replay) =>
      replay.turns.map((turn, index) =>
        turnView(
          turn,
          replay.turnsOmitted + index + 1,
          isOpen(opened, turn.id, latest(replay)),
          limitOf(shown, turn.id),
        ),
      ),
    toggle: (turn) => {
      setOpened((held) => toggled(held, turn.id, turn.open));
    },
    showMore: (turn) => {
      setShown((held) => moreShown(held, turn.id));
    },
    report: {
      label: (replay) => reportLabel(reported, replay.reportedAt),
      explained: REPORT_EXPLAINED,
      held: (replay) => reportHeld(reported, replay.reportedAt),
      busy: reporting.busy,
      line: reportLine(reported),
      run: () => {
        reporting
          .run('report')
          .then((result) => {
            const next = reportStateOf(result);
            setReported(next);
            if (next.kind === 'reported') toast.succeeded(REPORTED_LABEL);
          })
          .catch(() => undefined);
      },
    },
    export: {
      label: EXPORT_LABEL,
      explained: EXPORT_EXPLAINED,
      busy: exporting.busy,
      run: () => {
        exporting
          .save()
          .then((result) => {
            if (result.ok) toast.succeeded(caseSavedText(result.data.fileName));
            else toast.failed(exportFailureText(result));
          })
          .catch(() => undefined);
      },
    },
    words: {
      title: REPLAY_TITLE,
      back: BACK_LABEL,
      failed: REPLAY_FAILED,
      loading: REPLAY_LOADING,
      withheld: WITHHELD_NOTE,
      asked: ASKED,
      changes: CHANGES,
      noChanges: NO_CHANGES,
      steps: STEPS,
      decisions: DECISIONS,
      whyModel: WHY_MODEL,
      whyStopped: WHY_STOPPED,
      notEnded: NOT_ENDED,
      show: SHOW_TURN,
      hide: HIDE_TURN,
      more: MORE_EVENTS,
      notShown: EVENTS_NOT_SHOWN,
      omitted: TURNS_OMITTED,
      answers: ANSWERS,
      nothing: NOTHING,
      inPart: SHOWN_IN_PART,
      facts: FACTS,
      approvalColumns: APPROVAL_COLUMNS,
      openSubject,
    },
    tone: stopTone,
    approvalTone,
  };
}
