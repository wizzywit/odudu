export const MAX_TEMPLATE_LENGTH = 65_536;
export const MAX_SLOT_NAME_LENGTH = 64;

export interface Slot {
  kind: 'part' | 'text' | 'malformed';
  name: string;
  index: number;
  end: number;
}

// Two shapes and nothing else: {{part.name}} and {{t "catalogue.key"}}. Any
// other {{ or }} matches the last alternative, so a stray brace is reported
// rather than left in the output. Segments are separated by a literal dot,
// so the pattern cannot backtrack over its own repetitions.
const NAME = String.raw`[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*`;
const TOKEN = new RegExp(String.raw`\{\{(?:(${NAME})|t "(${NAME})")\}\}|\{\{|\}\}`, 'g');

export function scanSlots(template: string): Slot[] {
  const slots: Slot[] = [];
  for (const match of template.matchAll(TOKEN)) {
    const [raw, part, text] = match;
    const end = match.index + raw.length;
    const name = part ?? text;
    const kind = part !== undefined ? 'part' : 'text';
    if (name === undefined || name.length > MAX_SLOT_NAME_LENGTH) {
      slots.push({ kind: 'malformed', name: '', index: match.index, end });
    } else {
      slots.push({ kind, name, index: match.index, end });
    }
  }
  return slots;
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;');
}

// Parts are server-built markup and go in as they are; catalogue text is
// escaped. An inserted value is never scanned again.
export function fillTemplate(
  template: string,
  parts: Readonly<Record<string, string>>,
  t: (key: string) => string,
): string {
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new Error(`template too long: ${String(template.length)} characters`);
  }
  let out = '';
  let from = 0;
  for (const slot of scanSlots(template)) {
    out += template.slice(from, slot.index);
    from = slot.end;
    if (slot.kind === 'malformed') {
      throw new Error(`malformed slot at ${String(slot.index)}`);
    }
    if (slot.kind === 'text') {
      out += escapeText(t(slot.name));
    } else {
      const part = Object.hasOwn(parts, slot.name) ? parts[slot.name] : undefined;
      if (part === undefined) throw new Error(`unknown slot ${slot.name}`);
      out += part;
    }
  }
  return out + template.slice(from);
}
