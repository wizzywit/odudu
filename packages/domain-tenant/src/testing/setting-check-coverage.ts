export interface SettingCheckReading {
  /** Each two-setting ordering the definition holds, as `lower<=upper`. */
  readonly orderings: readonly string[];
  /** Setting columns still named once every recognised shape is removed. */
  readonly leftovers: readonly string[];
}

const ORDERING = /\(([a-z_]+) (<=|>=) ([a-z_]+)\)/gu;
const BOUND = /\(([a-z_]+) (?:<=|>=|<|>|=|<>) -?\d+\)/gu;
const ENUMERATION = /\(([a-z_]+) = ANY \(ARRAY\[[^\]]*\]\)\)/gu;
const CONTAINMENT = /\(([a-z_]+) (?:@>|<@) ARRAY\[[^\]]*\]\)/gu;
const CARDINALITY = /\(cardinality\(([a-z_]+)\) (?:<=|>=|<|>|=) \d+\)/gu;
const NULLABLE = /\(([a-z_]+) IS NULL\)/gu;
const MEMBERSHIP = /\(([a-z_]+) = ANY \(([a-z_]+)\)\)/gu;
const WORD = /\b[a-z_]+\b/gu;
// A quoted literal, such as a pattern or an enumeration member, names no column.
const LITERAL = /'(?:[^']|'')*'/gu;

/**
 * A CHECK definition as `pg_get_constraintdef` prints it, read for the
 * shapes the settings predicate restates: a column against a number, a
 * column against an enumeration or a list's members, a list's length, a column
 * held to the members of a list column, and one column ordered under another.
 * Anything else naming a setting column is left over, so a shape nobody
 * taught this to read fails a caller rather than passing unseen.
 */
export function readSettingCheck(
  definition: string,
  settingColumns: ReadonlySet<string>,
): SettingCheckReading {
  const orderings: string[] = [];
  let rest = definition
    .replace(LITERAL, "''")
    .replace(ORDERING, (whole, left: string, operator: string, right: string) => {
      if (!settingColumns.has(left) || !settingColumns.has(right)) return whole;
      orderings.push(operator === '<=' ? `${left}<=${right}` : `${right}<=${left}`);
      return 'TRUE';
    });
  rest = rest.replace(MEMBERSHIP, (whole, left: string, right: string) =>
    settingColumns.has(left) && settingColumns.has(right) ? 'TRUE' : whole,
  );
  for (const shape of [NULLABLE, CARDINALITY, BOUND, ENUMERATION, CONTAINMENT]) {
    rest = rest.replace(shape, (whole, column: string) =>
      settingColumns.has(column) ? 'TRUE' : whole,
    );
  }
  const leftovers = [...new Set(rest.match(WORD) ?? [])].filter((word) => settingColumns.has(word));
  return { orderings, leftovers };
}
