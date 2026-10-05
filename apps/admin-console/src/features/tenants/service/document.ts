import { TENANT_IMPORT_BODY_LIMIT } from '@odudu/contracts/admin';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

// What an export says it left out, by JSON path; read only to show it, since
// the file saved is the text as the server sent it.
export function omittedOf(text: string): readonly string[] {
  const document = parsed(text);
  if (!isRecord(document)) return [];
  const omitted = document.omitted;
  return Array.isArray(omitted)
    ? omitted.filter((path): path is string => typeof path === 'string')
    : [];
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function importFileProblem(bytes: number): string | null {
  if (bytes <= TENANT_IMPORT_BODY_LIMIT) return null;
  return `The file is larger than ${fileSize(TENANT_IMPORT_BODY_LIMIT)}, the most an import accepts.`;
}

export type ParsedDocument = { ok: true; document: unknown } | { ok: false; message: string };

export function parseDocument(text: string): ParsedDocument {
  const document = parsed(text);
  return document === undefined
    ? { ok: false, message: 'The file is not JSON, so it cannot be a tenant document.' }
    : { ok: true, document };
}

export interface ChosenFile {
  name: string;
  size: string;
}

export function chosenFileOf(file: { name: string; size: number } | null): ChosenFile | null {
  return file === null ? null : { name: file.name, size: fileSize(file.size) };
}

// Chosen from the picker: nothing chosen is nothing wrong yet.
export function fileChosenProblem(file: { size: number } | null): string | null {
  return file === null ? null : importFileProblem(file.size);
}

export function fileRequiredProblem(file: { size: number } | null): string | null {
  return file === null ? 'Choose a tenant document to import.' : importFileProblem(file.size);
}
