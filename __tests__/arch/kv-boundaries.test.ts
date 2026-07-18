import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "lib", "scripts"];

function sourceFiles(): string[] {
  const files: string[] = [];
  const visit = (entry: string) => {
    if (!fs.existsSync(entry)) return;
    for (const item of fs.readdirSync(entry, { withFileTypes: true })) {
      const itemPath = path.join(entry, item.name);
      if (item.isDirectory()) visit(itemPath);
      else if (/\.(?:ts|tsx)$/.test(item.name) && !item.name.endsWith(".d.ts")) files.push(itemPath);
    }
  };
  SOURCE_ROOTS.forEach((dir) => visit(path.join(ROOT, dir)));
  return files;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function moduleReferences(file: string): Array<{ source: string; reexport: boolean }> {
  const text = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const references: Array<{ source: string; reexport: boolean }> = [];

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ source: node.moduleSpecifier.text, reexport: false });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ source: node.moduleSpecifier.text, reexport: true });
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({ source: node.arguments[0].text, reexport: false });
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)
    ) {
      references.push({ source: node.argument.literal.text, reexport: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function resolveModule(importer: string, source: string): string | null {
  let resolved: string;
  if (source.startsWith("@/")) resolved = path.join(ROOT, source.slice(2));
  else if (source.startsWith(".")) resolved = path.resolve(path.dirname(importer), source);
  else return null;

  for (const candidate of [resolved, `${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, "index.ts")]) {
    if (fs.existsSync(candidate)) return path.normalize(candidate);
  }
  return path.normalize(resolved);
}

function exportedNames(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) names.add("*");
      else statement.exportClause.elements.forEach((item) => names.add(item.name.text));
      continue;
    }
    const exported = ts.canHaveModifiers(statement)
      && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      });
    } else if (
      (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement))
      && statement.name
    ) {
      names.add(statement.name.text);
    }
  }
  return [...names].sort();
}

describe("KV architecture boundaries", () => {
  const files = sourceFiles();
  const raw = path.join(ROOT, "lib/api/kv/internal/raw.ts");
  const factory = path.join(ROOT, "lib/api/kv/internal/factory.ts");
  const namespaceCallers = new Set([
    path.join(ROOT, "lib/api/kv/namespace.ts"),
    path.join(ROOT, "lib/api/kv/journalNamespace.ts"),
    path.join(ROOT, "lib/api/kv/reconcileJournal.ts"),
  ].map(path.normalize));
  const settlementJournal = path.normalize(path.join(ROOT, "lib/d2a/settlementJournal.ts"));

  it("keeps raw KV and namespace factories behind their approved importers", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const ref of moduleReferences(file)) {
        const target = resolveModule(file, ref.source);
        if (ref.source === "@vercel/kv" && path.normalize(file) !== path.normalize(raw)) {
          violations.push(`${relative(file)} imports @vercel/kv`);
        }
        if (target === path.normalize(raw) && path.normalize(file) !== path.normalize(factory)) {
          violations.push(`${relative(file)} imports internal/raw`);
        }
        if (target === path.normalize(factory) && !namespaceCallers.has(path.normalize(file))) {
          violations.push(`${relative(file)} imports internal/factory`);
        }
        if (
          target === path.normalize(path.join(ROOT, "lib/api/kv/journalNamespace.ts"))
          && path.normalize(file) !== settlementJournal
        ) {
          violations.push(`${relative(file)} imports journalNamespace`);
        }
        if (
          target === path.normalize(path.join(ROOT, "lib/api/kv/reconcileJournal.ts"))
          && !relative(file).startsWith("scripts/")
        ) {
          violations.push(`${relative(file)} imports reconcileJournal`);
        }
        if (
          (relative(file).startsWith("app/") || relative(file).startsWith("lib/"))
          && target
          && relative(target).startsWith("scripts/")
        ) {
          violations.push(`${relative(file)} imports scripts/`);
        }
        if (
          ref.reexport
          && target
          && relative(target).startsWith("lib/api/kv/internal/")
          && !relative(file).startsWith("lib/api/kv/")
        ) {
          violations.push(`${relative(file)} re-exports KV internals`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("exports only the approved KV capabilities", () => {
    const expected: Record<string, string[]> = {
      "lib/api/kv/internal/raw.ts": ["getRawKV"],
      "lib/api/kv/internal/factory.ts": ["kvNamespace"],
      "lib/api/kv/namespace.ts": ["dailyBudgetKV", "metricsKV", "rateLimitKV", "scoreBudgetKV", "scoreCacheKV"],
      "lib/api/kv/journalNamespace.ts": ["journalKV"],
      "lib/api/kv/reconcileJournal.ts": [
        "IndexedResolution",
        "ReconcileResolution",
        "acquireRunbookLock",
        "assertCompensationTombstonesPermanent",
        "incrementRunbookEpoch",
        "listResolutions",
        "listStalePending",
        "pruneMissingPending",
        "readJournalReport",
        "readReconcileCandidate",
        "readResolution",
        "readRunbookEpoch",
        "readRunbookLock",
        "readSettlementMetrics",
        "writeCompensationTombstone",
        "writeResolution",
      ],
    };
    for (const [file, names] of Object.entries(expected)) {
      expect(exportedNames(path.join(ROOT, file))).toEqual([...names].sort());
    }
  });

  it("defines the journal prefix only in the two journal namespace modules", () => {
    const occurrences = files
      .filter((file) => fs.readFileSync(file, "utf8").includes("aegis:journal:"))
      .map(relative)
      .sort();
    expect(occurrences).toEqual([
      "lib/api/kv/journalNamespace.ts",
      "lib/api/kv/reconcileJournal.ts",
    ]);
  });
});
