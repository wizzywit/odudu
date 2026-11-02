import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export interface ModuleReference {
  specifier: string;
  typeOnly: boolean;
  line: number;
}

export interface SourceReferences {
  file: string;
  references: ModuleReference[];
}

const APP_SOURCES = ['apps/admin-console/src/**/*.{ts,tsx}', 'apps/docs/src/**/*.{ts,tsx}'];

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  const bindings = clause.namedBindings;
  return (
    !clause.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

export function moduleReferences(file: string, text: string): ModuleReference[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: ModuleReference[] = [];
  const add = (literal: ts.StringLiteralLike, typeOnly: boolean): void => {
    const line = source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1;
    found.push({ specifier: literal.text, typeOnly, line });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier, isTypeOnlyImport(node));
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, isTypeOnlyExport(node));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) add(argument, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export async function scanApps(root: string): Promise<SourceReferences[]> {
  const files: string[] = [];
  for (const pattern of APP_SOURCES) {
    for await (const entry of glob(pattern, { cwd: root })) {
      files.push(entry.split(path.sep).join('/'));
    }
  }
  files.sort();
  const scanned: SourceReferences[] = [];
  for (const file of files) {
    const text = await readFile(path.join(root, file), 'utf8');
    scanned.push({ file, references: moduleReferences(file, text) });
  }
  return scanned;
}

export function segments(value: string): string[] {
  return value.split('/');
}
