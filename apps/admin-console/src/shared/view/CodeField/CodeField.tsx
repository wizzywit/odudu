import {
  createContext,
  Fragment,
  use,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { TextArea, TextField as AriaTextField } from 'react-aria-components';
import {
  caretAt,
  gutterParts,
  highlight,
  indentEdit,
  insertEdit,
  keyStep,
  lineCount,
  lineLabel,
  markedLines,
  normalisedBreaks,
  PLAIN_NOTE,
  scrollTarget,
  TAB_LEAD,
  TAB_THEN,
  tokensByLine,
  WRAP_LABEL,
  type CodeLanguage,
  type CodeToken,
  type LineIssue,
  type TokenKind,
} from '#/shared/service/code';
import {
  Description,
  FieldsReadOnly,
  Header,
  invalid,
  Message,
  VALIDATION,
  type Chrome,
} from '#/shared/view/Field';
import { useCodeHistory } from '#/shared/usecase/useCodeHistory';
import { Button } from '#/shared/view/Button';
import { KeyHint } from '#/shared/view/KeyHint';
import type { SizeReading } from '#/shared/service/format';
import styles from '#/shared/view/CodeField/CodeField.module.css';

const TOKEN_CLASS: Readonly<Record<TokenKind, string | undefined>> = {
  plain: undefined,
  value: undefined,
  comment: styles.comment,
  keyword: styles.keyword,
  function: styles.keyword,
  selector: styles.selector,
  property: styles.property,
  tag: styles.property,
  string: styles.string,
  number: styles.number,
  attribute: styles.number,
  part: styles.part,
};

function Token({ token }: { token: CodeToken }) {
  const className = TOKEN_CLASS[token.kind];
  return className === undefined ? token.text : <span className={className}>{token.text}</span>;
}

// The colour drawn behind the text of the field, line by line. Every line
// ends in a break, so the last one holds its height as the field's does.
function Layer({ tokens, marked }: { tokens: readonly CodeToken[]; marked: ReadonlySet<number> }) {
  return (
    <pre className={styles.layer} aria-hidden="true">
      {tokensByLine(tokens).map((line, index) => (
        <Fragment key={index}>
          <span className={styles.line} data-marked={marked.has(index + 1) || undefined}>
            {line.map((token, at) => (
              <Token key={`${String(at)}:${token.kind}`} token={token} />
            ))}
          </span>
          {'\n'}
        </Fragment>
      ))}
    </pre>
  );
}

function Gutter({ count, marked }: { count: number; marked: readonly number[] }) {
  return (
    <div className={styles.gutter} aria-hidden="true">
      {gutterParts(count, marked).map((part, index) =>
        part.marked ? (
          <span key={`m${String(index)}`} className={styles.marked}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </div>
  );
}

// What `tools` call to type at the caret of the field they sit in: one step
// of its history, with focus returned to it.
export const CodeInsert = createContext<(text: string) => void>(() => undefined);

const FALLBACK_TAB_WIDTH = 8;
const PROBE_LENGTH = 20;

// How wide one character is where the text is drawn, measured with a hidden
// run of them set in the same face.
function characterWidth(scroller: HTMLElement): number {
  const probe = document.createElement('span');
  probe.className = styles.probe ?? '';
  probe.textContent = '0'.repeat(PROBE_LENGTH);
  scroller.append(probe);
  const width = probe.getBoundingClientRect().width / PROBE_LENGTH;
  probe.remove();
  return width;
}

// After the field set the caret from code, which does not scroll to it:
// brings it into view in whatever scrolls, the layer's scroller or, beyond
// the colouring limit, the textarea itself.
function reveal(area: HTMLTextAreaElement): void {
  // A wrapped line is more than one row, which the metrics below do not know.
  if (area.closest('[data-wrap]') !== null) return;
  const plain = area.closest('[data-plain]') !== null;
  const scroller = plain ? area : area.closest('[data-code-scroller]');
  const style = getComputedStyle(area);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!(scroller instanceof HTMLElement) || !Number.isFinite(lineHeight)) return;
  const charWidth = characterWidth(plain ? (area.parentElement ?? area) : scroller);
  if (!(charWidth > 0)) return;
  const frame = scroller.getBoundingClientRect();
  const box = area.getBoundingClientRect();
  const offsetX = plain ? 0 : box.left - frame.left + scroller.scrollLeft;
  const offsetY = plain ? 0 : box.top - frame.top + scroller.scrollTop;
  const tabWidth = Number.parseInt(style.tabSize, 10);
  const target = scrollTarget(
    caretAt(
      area.value,
      area.selectionEnd,
      Number.isFinite(tabWidth) ? tabWidth : FALLBACK_TAB_WIDTH,
    ),
    {
      lineHeight,
      charWidth,
      originX: offsetX + Number.parseFloat(style.paddingLeft),
      originY: offsetY + Number.parseFloat(style.paddingTop),
      inset: offsetX,
    },
    {
      scrollTop: scroller.scrollTop,
      scrollLeft: scroller.scrollLeft,
      clientHeight: scroller.clientHeight,
      clientWidth: scroller.clientWidth,
    },
  );
  if (target.top !== null) scroller.scrollTop = target.top;
  if (target.left !== null) scroller.scrollLeft = target.left;
}

// A text field for code: the textarea is the control, with a coloured copy
// of its text behind it and line numbers beside it. Tab indents; Escape then
// Tab leaves. Where the server refused a line, that line carries a mark and
// the reason is listed under the field.
export function CodeField({
  label,
  description,
  error,
  changed,
  isDisabled,
  language,
  value,
  onChange,
  size,
  issues = [],
  tools,
}: Chrome & {
  language: CodeLanguage;
  value: string;
  onChange: (value: string) => void;
  size?: SizeReading;
  issues?: readonly LineIssue[];
  // Controls drawn above the field that put text into it through
  // `CodeInsert`. Not drawn for a read-only field.
  tools?: ReactNode;
}) {
  const issuesId = useId();
  const readOnly = use(FieldsReadOnly);
  const escaped = useRef(false);
  const refocus = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(refocus.current);
    },
    [],
  );
  const inert = readOnly || (isDisabled ?? false);
  const [wrapped, setWrapped] = useState(false);
  const [areaRef, history] = useCodeHistory({ value, onChange, readOnly, moved: reveal });
  const { tokens, plain } = highlight(language, value);
  const count = lineCount(normalisedBreaks(value));
  const marks = markedLines(issues, count);

  const insert = (text: string): void => {
    const area = areaRef.current;
    if (area === null || inert) return;
    history.replace(insertEdit(area.value, area.selectionStart, area.selectionEnd, text));
    // After the control that chose the text has put its own focus back.
    clearTimeout(refocus.current);
    refocus.current = setTimeout(() => {
      area.focus();
    }, 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (readOnly) return;
    const press = {
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      composing: event.nativeEvent.isComposing || history.composing(),
    };
    if (history.keyed(press, event)) return;
    const step = keyStep(press, escaped.current);
    escaped.current = step.escaped;
    if (step.action === 'none') return;
    event.preventDefault();
    const area = event.currentTarget;
    const edit = indentEdit(
      area.value,
      area.selectionStart,
      area.selectionEnd,
      step.action === 'outdent',
    );
    if (edit !== null) history.replace(edit);
  };

  return (
    <div className={styles.root}>
      {tools === undefined || inert ? null : <CodeInsert value={insert}>{tools}</CodeInsert>}
      <AriaTextField
        {...VALIDATION}
        {...invalid(error)}
        isDisabled={isDisabled ?? false}
        isReadOnly={readOnly}
        value={value}
        onChange={history.change}
        autoComplete="off"
        className={styles.field ?? ''}
        data-changed={changed === true || undefined}
        {...(issues.length === 0 ? {} : { 'aria-describedby': issuesId })}
      >
        <Header label={label} {...(changed === undefined ? {} : { changed })} />
        <div className={styles.wrap}>
          <Button
            size="small"
            variant={wrapped ? 'primary' : 'secondary'}
            aria-pressed={wrapped}
            onPress={() => {
              setWrapped((was) => !was);
            }}
          >
            {WRAP_LABEL}
          </Button>
        </div>
        <div
          className={styles.frame}
          data-plain={plain || undefined}
          data-wrap={wrapped || undefined}
        >
          <div className={styles.scroller} data-code-scroller>
            {plain ? null : <Gutter count={count} marked={marks} />}
            <div className={styles.stage}>
              {plain ? null : <Layer tokens={tokens} marked={new Set(marks)} />}
              <TextArea
                ref={areaRef}
                className={styles.area ?? ''}
                data-control
                wrap={wrapped ? 'soft' : 'off'}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onKeyDown={onKeyDown}
                onPointerDown={() => {
                  escaped.current = false;
                }}
                onCompositionStart={history.compositionStart}
                onCompositionEnd={history.compositionEnd}
                onBlur={() => {
                  escaped.current = false;
                }}
              />
            </div>
          </div>
        </div>
        <Description>
          {description === undefined ? null : <>{description} </>}
          <span className={styles.hint}>
            <KeyHint lead={TAB_LEAD} keys={['Escape']} /> <KeyHint lead={TAB_THEN} keys={['Tab']} />
          </span>
          {plain ? <span>{PLAIN_NOTE}</span> : null}
          {size === undefined ? null : (
            <span className={styles.size} data-over={size.over || undefined}>
              {size.text}
            </span>
          )}
        </Description>
        {issues.length === 0 ? null : (
          <ul id={issuesId} className={styles.issues}>
            {issues.map((issue, index) => (
              <li key={`${String(issue.line)}:${String(index)}`}>
                <span aria-hidden="true" className={styles.bang}>
                  !{' '}
                </span>
                {lineLabel(issue)}
              </li>
            ))}
          </ul>
        )}
        <Message error={error} />
      </AriaTextField>
    </div>
  );
}
