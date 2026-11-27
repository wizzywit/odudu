export type SafeNode =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'pre'; text: string }
  | { kind: 'br' }
  | {
      kind:
        | 'strong'
        | 'em'
        | 'p'
        | 'ul'
        | 'ol'
        | 'li'
        | 'table'
        | 'thead'
        | 'tbody'
        | 'tr'
        | 'th'
        | 'td';
      children: readonly SafeNode[];
    }
  | { kind: 'link'; href: string; children: readonly SafeNode[] };

// How many more nodes one message may make.
export interface Budget {
  left: number;
}
