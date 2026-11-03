import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { areaAt, areaHref, type Area } from '#/entities/area';
import type { AuditEvent, AuditHrefs } from '#/entities/audit-event';
import { clientHref } from '#/entities/client';
import { groupHref } from '#/entities/group';
import { roleHref } from '#/entities/role';
import { scopeHref } from '#/entities/scope';
import { useAuditList, type AuditList } from '#/pages/audit/repository/useAuditList';
import { useExportEvents, type ExportEvents } from '#/pages/audit/use-cases/useExportEvents';
import { lastDay, tooBroadAdvice } from '#/pages/audit/services/tooBroad';
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
import { loadedRange } from '#/pages/audit/services/trailCount';
import { FILTER_WORDS, type FilterWords } from '#/pages/audit/services/filterWords';
import { auditArea } from '#/pages/audit/services/auditArea';
import { AUDIT_PAGE_WORDS, type AuditPageWords } from '#/pages/audit/services/auditPageWords';
import { holds } from '#/shared/services/access';
import { useNow } from '#/shared/use-cases/useNow';
import { localZone } from '#/shared/services/zones';
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
  advice: string;
  // Reads again with the day up to now added to the filters held.
  searchLastDay: () => void;
}

export interface AuditPageState {
  // What the area is called, for the heading and for a refusal to name.
  title: string;
  // Every fixed sentence and label the page shows, by section.
  words: AuditPageWords;
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

// The gate wraps the page, so it cannot read the page hook: it takes the area here.
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
    words: AUDIT_PAGE_WORDS,
    list,
    form,
    exporting,
    tooBroad: {
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
