import type { AuditEvent } from '#/entities/audit-event';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { areaAt, areaHref, type Area } from '#/entities/area';
import { CORRELATION_NOTE } from '#/entities/audit-event';
import { clientHref } from '#/entities/client';
import { groupHref } from '#/entities/group';
import { roleHref } from '#/entities/role';
import { scopeHref } from '#/entities/scope';
import { useAuditList, type AuditList } from '#/pages/audit/repository/useAuditList';
import { useExportEvents, type ExportEvents } from '#/pages/audit/use-cases/useExportEvents';
import {
  lastDay,
  SEARCH_LAST_DAY,
  TOO_BROAD_TITLE,
  tooBroadAdvice,
} from '#/pages/audit/services/tooBroad';
import { auditQuery } from '#/pages/audit/services/auditAddress';
import {
  applyBlocked,
  draftProblems,
  isClean,
  shownProblems,
  withUnreadable,
  type DraftProblems,
  type Unreadable,
} from '#/pages/audit/services/draftValidation';
import {
  choiceOf,
  draftOf,
  EMPTY_DRAFT,
  filtersOf,
  hasResourceType,
  withField,
  type Draft,
} from '#/pages/audit/services/filterDraft';
import { isFiltered, type FilterName } from '#/pages/audit/services/auditFilters';
import { actorHref, resourceHref, type RecordPages } from '#/pages/audit/services/resourceLinks';
import { loadedRange, NO_COUNT, TRAIL_LABEL } from '#/pages/audit/services/trailCount';
import {
  NOTHING_MATCHES,
  NOTHING_MATCHES_TITLE,
  NOTHING_YET,
  NOTHING_YET_TITLE,
  SHOW_EVERY_EVENT,
} from '#/pages/audit/services/emptyTrail';
import { STALE_TEXT, STALE_TITLE, START_AGAIN } from '#/pages/audit/services/staleTrail';
import { EXPORT_NOTE } from '#/pages/audit/services/auditExport';
import { FILTER_WORDS, type FilterWords } from '#/pages/audit/services/filterWords';
import { auditArea } from '#/pages/audit/services/auditArea';
import {
  EXPORT_LABEL,
  EXPORTING_LABEL,
  LAST_EXPORT_LABEL,
  LOAD_FAILED,
  LOAD_MORE_NOUN,
  LOADING_LABEL,
  PAGE_DESCRIPTION,
} from '#/pages/audit/services/pageWords';
import { holds } from '#/shared/services/access';
import { useNow } from '#/shared/use-cases/useNow';
import { localZone } from '#/shared/services/zones';
import type { AuditHrefs } from '#/entities/audit-event';
import { subjectHref } from '#/entities/subject';

const RECORD_PAGES: RecordPages = {
  subject: subjectHref,
  client: clientHref,
  group: groupHref,
  role: roleHref,
  scope: scopeHref,
};

export interface AuditFilterForm {
  draft: Draft;
  // Shown once the form has been submitted with them in it.
  problems: DraftProblems;
  set: (name: FilterName, value: string) => void;
  // Told by a date field what is typed in it that no instant reads from.
  report: (name: 'from' | 'to', message: string | null) => void;
  // Why Apply is held, while a date is typed that reads as nothing.
  blocked: string | null;
  submit: () => void;
  clear: () => void;
  // Whether there is anything to clear: a filter held, or typed.
  filtered: boolean;
  // What a select shows for a draft field, and whether the draft names a
  // resource type, which a resource id needs.
  choice: (name: FilterName) => string;
  hasType: boolean;
  words: FilterWords;
}

export interface TooBroad {
  title: string;
  advice: string;
  searchLastDayLabel: string;
  // Reads again with the day up to now added to the filters held.
  searchLastDay: () => void;
}

export interface AuditPageState {
  // What the area is called, for the heading and for a refusal to name.
  title: string;
  // What the table and the pager are called.
  trailLabel: string;
  header: { description: string; exportLabel: string; exportingLabel: string };
  notes: { noCount: string; correlation: string; export: string; lastExport: string };
  load: { loading: string; failed: string; moreFailedNoun: string };
  empty: {
    yetTitle: string;
    yetText: string;
    matchesTitle: string;
    matchesText: string;
    showEvery: string;
  };
  stale: { title: string; text: string; startAgain: string };
  list: AuditList;
  form: AuditFilterForm;
  hrefs: AuditHrefs;
  exporting: ExportEvents;
  tooBroad: TooBroad;
  // Whether the address holds any filter the trail can read.
  narrowed: boolean;
  // How far back the rows loaded reach, since the trail has no count.
  range: string | null;
}

function useFilterForm(list: AuditList): AuditFilterForm {
  const held = auditQuery(list.filters).toString();
  const [synced, setSynced] = useState(held);
  const [draft, setDraft] = useState(() => draftOf(list.filters));
  const [attempted, setAttempted] = useState(false);
  const [unreadable, setUnreadable] = useState<Unreadable>({});
  // Back, forward and a shared link change the address under the form.
  if (synced !== held) {
    setSynced(held);
    setDraft(draftOf(list.filters));
    setAttempted(false);
  }
  const problems = draftProblems(draft, unreadable);
  const blocked = applyBlocked(unreadable);
  return {
    draft,
    problems: shownProblems(problems, attempted),
    blocked,
    report: (name, message) => {
      setUnreadable((was) => withUnreadable(was, name, message));
    },
    set: (name, value) => {
      setDraft((was) => withField(was, name, value));
    },
    submit: () => {
      setAttempted(true);
      if (blocked === null && isClean(problems)) list.apply(filtersOf(draft));
    },
    clear: () => {
      setDraft(EMPTY_DRAFT);
      setAttempted(false);
      list.apply({});
    },
    filtered: isFiltered(list.filters) || isFiltered(filtersOf(draft)),
    choice: (name) => choiceOf(draft, name),
    hasType: hasResourceType(draft),
    words: FILTER_WORDS,
  };
}

export function useAuditArea(): { area: Area; title: string } {
  return auditArea();
}

export function useAuditPage(tenant: string): AuditPageState {
  const { title } = auditArea();
  const list = useAuditList(tenant);
  const form = useFilterForm(list);
  const exporting = useExportEvents(tenant, list.filters);
  const now = useNow(60_000);
  const mayReadSubjects = holds(useAuthority(tenant), 'view-users');
  return {
    title,
    trailLabel: TRAIL_LABEL,
    header: {
      description: PAGE_DESCRIPTION,
      exportLabel: EXPORT_LABEL,
      exportingLabel: EXPORTING_LABEL,
    },
    notes: {
      noCount: NO_COUNT,
      correlation: CORRELATION_NOTE,
      export: EXPORT_NOTE,
      lastExport: LAST_EXPORT_LABEL,
    },
    load: { loading: LOADING_LABEL, failed: LOAD_FAILED, moreFailedNoun: LOAD_MORE_NOUN },
    empty: {
      yetTitle: NOTHING_YET_TITLE,
      yetText: NOTHING_YET,
      matchesTitle: NOTHING_MATCHES_TITLE,
      matchesText: NOTHING_MATCHES,
      showEvery: SHOW_EVERY_EVENT,
    },
    stale: { title: STALE_TITLE, text: STALE_TEXT, startAgain: START_AGAIN },
    list,
    form,
    exporting,
    tooBroad: {
      title: TOO_BROAD_TITLE,
      searchLastDayLabel: SEARCH_LAST_DAY,
      advice: tooBroadAdvice(list.filters),
      searchLastDay: () => {
        list.apply({ ...list.filters, ...lastDay(now) });
      },
    },
    hrefs: {
      resource: (event: AuditEvent) =>
        resourceHref(tenant, event.resource_type, event.resource_id, RECORD_PAGES, (path) =>
          areaHref(tenant, areaAt(path)),
        ),
      actor: (event: AuditEvent) => actorHref(tenant, event, mayReadSubjects, subjectHref),
    },
    narrowed: isFiltered(list.filters),
    range: loadedRange(list.rows, localZone()),
  };
}
