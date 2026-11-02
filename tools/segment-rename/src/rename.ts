import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import ts from 'typescript';

const SKIPPED = new Set(['node_modules', 'dist', '.git', 'build', '.docusaurus']);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const VITEST_CALLS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

export interface RenameResult {
  moved: string[];
  rewritten: string[];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, visit: (path: string, isDir: boolean) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    visit(path, entry.isDirectory());
    if (entry.isDirectory()) walk(path, visit);
  }
}

// The path a file or directory has once every renamed directory beneath
// `base` carries its new name. Only segments that are directories today are
// renamed, so a file called service.ts is never touched.
function renamedPath(base: string, path: string, mapping: Record<string, string>): string {
  const inside = relative(base, path);
  if (inside.startsWith('..') || inside === '') return path;
  const segments = inside.split(sep);
  let current = base;
  const out: string[] = [];
  for (const segment of segments) {
    current = join(current, segment);
    const target = mapping[segment];
    out.push(target !== undefined && isDirectory(current) ? target : segment);
  }
  return join(base, ...out);
}

function literalSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  const specifier = specifierOf(node);
  return specifier !== undefined && ts.isStringLiteralLike(specifier) ? specifier : undefined;
}

function callSpecifier(node: ts.CallExpression): ts.Expression | undefined {
  const callee = node.expression;
  const isLoader =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === 'require') ||
    (ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'vi' &&
      VITEST_CALLS.has(callee.name.text));
  return isLoader ? node.arguments[0] : undefined;
}

function specifierOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isCallExpression(node)) return callSpecifier(node);
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return node.argument.literal;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  return undefined;
}

function specifiers(source: ts.SourceFile): ts.StringLiteralLike[] {
  const found: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    const literal = literalSpecifier(node);
    if (literal !== undefined) found.push(literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function relativeSpecifier(from: string, to: string): string {
  const path = relative(from, to).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

function newSpecifier(
  text: string,
  file: string,
  src: string,
  aliasPrefix: string,
  mapping: Record<string, string>,
): string {
  if (text.startsWith(aliasPrefix)) {
    const target = join(src, text.slice(aliasPrefix.length));
    const renamed = renamedPath(src, target, mapping);
    return renamed === target ? text : aliasPrefix + relative(src, renamed).split(sep).join('/');
  }
  if (text.startsWith('./') || text.startsWith('../')) {
    const target = join(dirname(file), text);
    const movedFile = renamedPath(src, file, mapping);
    const movedTarget = renamedPath(src, target, mapping);
    if (movedFile === file && movedTarget === target) return text;
    return relativeSpecifier(dirname(movedFile), movedTarget);
  }
  return text;
}

function rewriteFile(
  file: string,
  src: string,
  aliasPrefix: string,
  mapping: Record<string, string>,
  dry: boolean,
): boolean {
  const content = readFileSync(file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const literal of specifiers(source)) {
    const next = newSpecifier(literal.text, file, src, aliasPrefix, mapping);
    if (next !== literal.text) {
      edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: next });
    }
  }
  if (edits.length === 0) return false;
  if (!dry) {
    let out = content;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    writeFileSync(file, out);
  }
  return true;
}

export function renameSegments(
  root: string,
  aliasPrefix: string,
  mapping: Record<string, string>,
  options: { dry?: boolean } = {},
): RenameResult {
  const dry = options.dry === true;
  const src = join(root, 'src');
  const directories: string[] = [];
  const files: string[] = [];
  walk(root, (path, isDir) => {
    if (isDir && mapping[path.split(sep).pop() ?? ''] !== undefined && path.startsWith(src + sep)) {
      directories.push(path);
    }
    if (!isDir && SOURCE.test(path)) files.push(path);
  });

  const rewritten = files.filter((file) => rewriteFile(file, src, aliasPrefix, mapping, dry));

  const moved: string[] = [];
  const deepestFirst = directories.sort((a, b) => b.split(sep).length - a.split(sep).length);
  for (const directory of deepestFirst) {
    const name = directory.split(sep).pop() ?? '';
    const target = join(dirname(directory), mapping[name] ?? name);
    moved.push(directory);
    if (!dry) execFileSync('git', ['mv', directory, target], { cwd: root });
  }
  return { moved, rewritten };
}
