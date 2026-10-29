export {
  highlight,
  lineCount,
  normalisedBreaks,
  tokensByLine,
} from '#/shared/service/code/highlight';
export {
  gutterParts,
  lineLabel,
  markedLines,
  type GutterPart,
  type LineIssue,
} from '#/shared/service/code/gutter';
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
} from '#/shared/service/code/editing';
export {
  HIGHLIGHT_LIMIT,
  PLAIN_NOTE,
  WRAP_LABEL,
  type CodeLanguage,
  type CodeToken,
  type Highlighted,
  type TokenKind,
} from '#/shared/service/code/tokens';
export { cssTokens } from '#/shared/service/code/css';
export { templateTokens, MARKER_LIMIT } from '#/shared/service/code/template';
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
} from '#/shared/service/code/history';
export {
  caretAt,
  scrollTarget,
  type Caret,
  type Metrics,
  type Scroll,
  type Viewport,
} from '#/shared/service/code/scroll';
export { patchBetween, snapshotOf, type Patch, type Snapshot } from '#/shared/service/code/patch';
