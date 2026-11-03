export {
  highlight,
  lineCount,
  normalisedBreaks,
  tokensByLine,
} from '#/shared/lib/services/code/highlight';
export {
  gutterParts,
  lineLabel,
  markedLines,
  type GutterPart,
  type LineIssue,
} from '#/shared/lib/services/code/gutter';
export {
  changesNothing,
  historyKey,
  indentEdit,
  insertEdit,
  INDENT,
  keyStep,
  TAB_LEAD,
  TAB_THEN,
  type KeyPress,
  type KeyStep,
  type TextEdit,
} from '#/shared/lib/services/code/editing';
export {
  HIGHLIGHT_LIMIT,
  PLAIN_NOTE,
  WRAP_LABEL,
  WRAP_NOTE,
  type CodeLanguage,
  type CodeToken,
  type Highlighted,
  type TokenKind,
} from '#/shared/lib/services/code/tokens';
export { cssTokens } from '#/shared/lib/services/code/css';
export { templateTokens, MARKER_LIMIT } from '#/shared/lib/services/code/template';
export {
  changed,
  committed,
  DISCRETE,
  EMPTY_HISTORY,
  HISTORY_MAX_BURST,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_JOIN,
  HISTORY_PAUSE_MS,
  inputIntent,
  reconciled,
  travelled,
  type EditKind,
  type History,
  type HistoryEdit,
  type InputIntent,
  type Pending,
  type Stepped,
} from '#/shared/lib/services/code/history';
export {
  caretAt,
  scrollTarget,
  type Caret,
  type Metrics,
  type Scroll,
  type Viewport,
} from '#/shared/lib/services/code/scroll';
export {
  patchBetween,
  snapshotOf,
  type Patch,
  type Snapshot,
} from '#/shared/lib/services/code/patch';
