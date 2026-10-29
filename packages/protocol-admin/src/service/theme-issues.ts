import { type FieldError } from '@odudu/contracts/admin';
import {
  type ContrastFailure,
  type StylesheetIssue,
  type StylesheetIssueCode,
  type TemplateIssue,
  type TemplateIssueCode,
} from '@odudu/domain-theme';

export const MAX_ISSUE_DETAIL = 80;

// Read before filtering, so cleaning an enormous echo costs a bounded amount.
const SCAN = 1024;

// Control characters, format characters (the bidirectional controls among
// them), line and paragraph separators and unpaired surrogates.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

// An issue's detail quotes what the tenant wrote (a slot name, a tag, a key),
// and goes into a JSON field a console shows. It is cut and cleaned here; it
// is never given to a renderer.
export function safeDetail(detail: string): string {
  const clean = detail.slice(0, SCAN).replace(UNSAFE, '');
  let out = '';
  let count = 0;
  for (const character of clean) {
    if (count === MAX_ISSUE_DETAIL) return `${out}…`;
    out += character;
    count += 1;
  }
  return out;
}

const TEMPLATE_MESSAGES: Record<TemplateIssueCode, string> = {
  'too-large': 'The template is larger than the limit.',
  'too-many-slots': 'The template has more slots than the limit.',
  'malformed-slot': 'A slot is not written as {{part}} or {{t "key"}}.',
  'unknown-slot': 'The slot is not a part of this page kind.',
  'unknown-message-key': 'The message key is not in the catalogue this page is filled from.',
  'missing-part': 'A part this page kind requires is missing.',
  'repeated-part': 'A part appears more than once.',
  'slot-in-attribute': 'A slot may not be inside an attribute.',
  'slot-in-raw-text': 'A slot may not be inside a raw-text element.',
  comment: 'Comments are not allowed.',
  'element-not-allowed': 'The element is not allowed in a template.',
  'attribute-not-allowed': 'The attribute is not allowed.',
  'href-not-https': 'A link must be an https address.',
  'link-rel': 'A link must carry rel="noopener noreferrer".',
  'img-src': 'An image must be one of this theme’s uploaded images.',
  'img-alt': 'An image must have alt text.',
  unterminated: 'The template ends inside a tag or a comment.',
  'unparsed-tag': 'A tag is not read as the author wrote it.',
  'unclosed-element': 'An element is never closed.',
  'too-deep': 'The template is nested deeper than the limit.',
  'too-many-elements': 'The template has more elements than the limit.',
  'form-pair': 'form.open and form.close come together, in that order.',
  'form-placement': 'A part that belongs inside the form is outside it.',
  'part-placement':
    'A part may not sit in a paragraph, heading, link or table part, where a browser moves it.',
};

const STYLESHEET_MESSAGES: Record<StylesheetIssueCode, string> = {
  'too-large': 'The stylesheet is larger than the limit.',
  unparsable: 'The stylesheet cannot be read.',
  'nul-byte': 'The stylesheet contains a NUL character.',
  'root-declaration': 'A declaration must be inside a rule.',
  'at-rule-not-allowed': 'The at-rule is not allowed.',
  'media-query-not-allowed': 'The media query is not allowed.',
  'selector-not-allowed': 'The selector is not allowed.',
  'unknown-class': 'The class is not one of the page’s documented hooks.',
  'property-not-allowed': 'The property is not allowed.',
  'value-not-allowed': 'The value is not allowed.',
  'url-not-allowed': 'The url() is not one of this theme’s uploaded images.',
  'too-many-rules': 'The stylesheet has more rules than the limit.',
  'too-many-declarations': 'The stylesheet has more declarations than the limit.',
  'too-long': 'A selector or value is longer than the limit.',
  'too-many-issues': 'The stylesheet has more problems than are listed.',
};

function located(
  path: string,
  issue: TemplateIssue | StylesheetIssue,
  message: string,
): FieldError {
  return {
    path,
    message,
    code: issue.code,
    detail: safeDetail(issue.detail),
    line: issue.line,
    column: issue.column,
  };
}

export function templateErrors(kind: string, issues: readonly TemplateIssue[]): FieldError[] {
  return issues.map((issue) => located(`templates.${kind}`, issue, TEMPLATE_MESSAGES[issue.code]));
}

export function stylesheetErrors(issues: readonly StylesheetIssue[]): FieldError[] {
  return issues.map((issue) => located('stylesheet', issue, STYLESHEET_MESSAGES[issue.code]));
}

// The foreground colour is the one named, since it is the one an author
// adjusts for a ratio; `detail` names the pair.
export function contrastErrors(failures: readonly ContrastFailure[]): FieldError[] {
  return failures.map((failure) => {
    const [foreground = '', background = ''] = failure.pair.split('/');
    return {
      path: `tokens.${failure.scheme}.${foreground}`,
      message: `Contrast against ${background} is ${failure.ratio.toFixed(2)}:1; ${String(failure.required)}:1 is required.`,
      code: 'contrast',
      detail: failure.pair,
    };
  });
}

export function missingAssetErrors(
  missing: readonly { path: string; assetId: string }[],
): FieldError[] {
  return missing.map(({ path, assetId }) => ({
    path,
    message: 'Names no image of this tenant.',
    code: 'asset-missing',
    detail: safeDetail(assetId),
  }));
}

export interface ThemeWarning {
  piece: string;
  code: 'stylesheet-unverified' | 'template-unverified';
  message: string;
}

// What publishing cannot prove (design spec section 12): a tenant's own
// stylesheet and templates are theirs to keep accessible.
export function themeWarnings(body: {
  stylesheet: string | null;
  templates: Partial<Record<string, string>>;
}): ThemeWarning[] {
  const warnings: ThemeWarning[] = [];
  if (body.stylesheet !== null) {
    warnings.push({
      piece: 'stylesheet',
      code: 'stylesheet-unverified',
      message:
        'A stylesheet can change any colour or hide any element, so its contrast and legibility are not checked; keeping it accessible is the tenant’s responsibility.',
    });
  }
  for (const kind of Object.keys(body.templates)) {
    warnings.push({
      piece: `templates.${kind}`,
      code: 'template-unverified',
      message:
        'A template places the page’s parts as its author chose, so its reading order and layout are not checked; keeping it accessible is the tenant’s responsibility.',
    });
  }
  return warnings;
}
