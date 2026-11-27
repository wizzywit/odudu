import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { subjectHref, subjectLinkOf } from '#/entities/subject';
import { useActivityList } from '#/pages/assistant-activity/repository/useAssistantActivity';
import {
  COLUMNS,
  COPY_ID,
  KEPT,
  openSubject,
  FILTERS,
  FILTER_HINTS,
  NOTHING_YET,
  NOUN,
  ONLY_THIS_PERSON,
  PAGE_RULE,
} from '#/pages/assistant-activity/services/activityText';
import {
  APPLIED,
  commitFilter,
  settledDrafts,
  typedValue,
  withDraft,
  withProblem,
  type Drafts,
  type Problems,
  type TextFilter,
} from '#/pages/assistant-activity/services/filters';
import { replayHref } from '#/pages/assistant-activity/services/addresses';
import {
  KIND_CHOICES,
  OUTCOME_CHOICES,
  choiceOf,
  stopTone,
  stopWord,
} from '#/pages/assistant-activity/services/outcome';
import {
  answersText,
  changesText,
  onlyPersonLabel,
  openLabel,
  personOf,
  titleOf,
  tokenBreakdown,
  tokenTotal,
  toolsText,
} from '#/pages/assistant-activity/services/rows';
import type { ActivityConversation } from '#/pages/assistant-activity/types/activity';
import { holds } from '#/shared/lib/services/access';
import type { Choice } from '#/shared/lib/services/choice';
import { statusFilter } from '#/shared/lib/services/filters';
import type { ResourceListState } from '#/shared/lib/services/resourceList';

export interface TextField {
  label: string;
  hint: string;
  value: string;
  error: string | undefined;
  change: (typed: string) => void;
  commit: () => void;
}

export interface SelectChoice {
  label: string;
  value: string;
  options: readonly Choice[];
  choose: (id: string) => void;
}

export interface ActivityPage {
  list: ResourceListState<ActivityConversation>;
  text: Readonly<Record<TextFilter, TextField>>;
  outcome: SelectChoice;
  kind: SelectChoice;
  // Where a person has their page, or none where the caller may not read subjects.
  personLink: ((id: string) => string) | null;
  onlyPerson: (person: string) => void;
  replayAt: (id: string) => string;
  words: {
    noun: typeof NOUN;
    rule: string;
    nothingYet: string;
    columns: typeof COLUMNS;
    onlyThisPerson: string;
    copyId: string;
    kept: typeof KEPT;
    openSubject: typeof openSubject;
  };
  say: {
    title: typeof titleOf;
    person: typeof personOf;
    answers: typeof answersText;
    total: typeof tokenTotal;
    breakdown: typeof tokenBreakdown;
    changes: typeof changesText;
    tools: typeof toolsText;
    stop: typeof stopWord;
    tone: typeof stopTone;
    onlyPerson: typeof onlyPersonLabel;
    open: typeof openLabel;
  };
}

export function useActivityPage(tenant: string): ActivityPage {
  const authority = useAuthority(tenant);
  const list = useActivityList(tenant);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [problems, setProblems] = useState<Problems>({});
  const textField = (name: TextFilter): TextField => ({
    label: FILTERS[name],
    hint: FILTER_HINTS[name],
    value: typedValue(drafts, list.filters, name),
    error: problems[name],
    change: (typed) => {
      setDrafts((held) => withDraft(held, name, typed));
    },
    commit: () => {
      const done = commitFilter(name, typedValue(drafts, list.filters, name));
      setProblems((held) => withProblem(held, name, done.problem));
      setDrafts((held) => settledDrafts(held, name, done));
      if (done.problem === undefined) list.setFilter(name, done.value);
    },
  });
  const forget = (name: TextFilter): void => {
    setDrafts((held) => settledDrafts(held, name, APPLIED));
    setProblems((held) => withProblem(held, name, undefined));
  };
  const select = (name: 'outcome' | 'kind', options: readonly Choice[]): SelectChoice => ({
    label: FILTERS[name],
    value: choiceOf(list.filters, name),
    options,
    choose: (id) => {
      list.setFilter(name, statusFilter(id));
    },
  });
  return {
    list: {
      ...list,
      clear: () => {
        setDrafts({});
        setProblems({});
        list.clear();
      },
    },
    text: {
      person: textField('person'),
      conversation: textField('conversation'),
      tool: textField('tool'),
    },
    outcome: select('outcome', OUTCOME_CHOICES),
    kind: select('kind', KIND_CHOICES),
    personLink: subjectLinkOf(holds(authority, 'view-users'), tenant, subjectHref),
    onlyPerson: (person) => {
      forget('person');
      list.setFilter('person', person);
    },
    replayAt: (id) => replayHref(tenant, id),
    words: {
      noun: NOUN,
      rule: PAGE_RULE,
      nothingYet: NOTHING_YET,
      columns: COLUMNS,
      onlyThisPerson: ONLY_THIS_PERSON,
      copyId: COPY_ID,
      kept: KEPT,
      openSubject,
    },
    say: {
      title: titleOf,
      person: personOf,
      answers: answersText,
      total: tokenTotal,
      breakdown: tokenBreakdown,
      changes: changesText,
      tools: toolsText,
      stop: stopWord,
      tone: stopTone,
      onlyPerson: onlyPersonLabel,
      open: openLabel,
    },
  };
}
