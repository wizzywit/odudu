import type { AuditEvent } from '#/entities/audit-event';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { areaAt, areaHref, type Area } from '#/entities/area';
import { clientHref } from '#/entities/client';
import { groupHref } from '#/entities/group';
import { roleHref } from '#/entities/role';
import { scopeHref } from '#/entities/scope';
import { useAuditList, type AuditList } from '#/features/audit/repository/useAuditList';
import { useExportEvents, type ExportEvents } from '#/features/audit/use-cases/useExportEvents';
import { lastDay, tooBroadAdvice } from '#/features/audit/services/tooBroad';
import { auditQuery } from '#/features/audit/services/auditAddress';
import {
  applyBlocked,
  draftProblems,
  isClean,
  shownProblems,
  withUnreadable,
  type DraftProblems,
  type Unreadable,
} from '#/features/audit/services/draftValidation';
import {
  draftOf,
  EMPTY_DRAFT,
  filtersOf,
  withField,
  type Draft,
} from '#/features/audit/services/filterDraft';
import { isFiltered, type FilterName } from '#/features/audit/services/auditFilters';
import { actorHref, resourceHref, type RecordPages } from '#/features/audit/services/resourceLinks';
import { loadedRange, TRAIL_LABEL } from '#/features/audit/services/trailCount';
import { NOTHING_YET_TITLE } from '#/features/audit/services/emptyTrail';
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
}

export interface TooBroad {
  advice: string;
  // Reads again with the day up to now added to the filters held.
  searchLastDay: () => void;
}

export interface AuditPageState {
  // What the area is called, for the heading and for a refusal to name.
  title: string;
  // What the table and the pager are called.
  trailLabel: string;
  nothingYetTitle: string;
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
  };
}

export function useAuditArea(): { area: Area; title: string } {
  const area = areaAt('audit');
  return { area, title: area.label };
}

export function useAuditPage(tenant: string): AuditPageState {
  const { title } = useAuditArea();
  const list = useAuditList(tenant);
  const form = useFilterForm(list);
  const exporting = useExportEvents(tenant, list.filters);
  const now = useNow(60_000);
  const mayReadSubjects = holds(useAuthority(tenant), 'view-users');
  return {
    title,
    trailLabel: TRAIL_LABEL,
    nothingYetTitle: NOTHING_YET_TITLE,
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
