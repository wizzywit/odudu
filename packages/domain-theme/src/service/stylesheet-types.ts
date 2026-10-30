export type StylesheetIssueCode =
  | 'too-large'
  | 'unparsable'
  | 'nul-byte'
  | 'root-declaration'
  | 'at-rule-not-allowed'
  | 'media-query-not-allowed'
  | 'selector-not-allowed'
  | 'unknown-class'
  | 'property-not-allowed'
  | 'value-not-allowed'
  | 'url-not-allowed'
  | 'too-many-rules'
  | 'too-many-declarations'
  | 'too-long'
  | 'too-many-issues';

export interface StylesheetIssue {
  code: StylesheetIssueCode;
  detail: string;
  // 1-based, columns in UTF-16 code units; null when the issue has no
  // single place (too large, too many).
  line: number | null;
  column: number | null;
}

export interface StylesheetOptions {
  // Whether a URL names one of the theme's own uploaded assets. Without it
  // no url() is acceptable.
  isAssetUrl?: (url: string) => boolean;
}

export interface Problem {
  code: StylesheetIssueCode;
  detail: string;
}
