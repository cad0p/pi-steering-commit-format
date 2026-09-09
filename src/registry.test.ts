// SPDX-License-Identifier: MIT
// Part of pi-steering-commit-format.

/**
 * Regression fence: verifies that the `declare global { interface
 * PiSteeringPredicates }` block in `./plugin.ts` is wired up
 * correctly — the `commitFormat` key typechecks inside a `Rule`'s
 * `when:` slot with its `require:` spread form, and unknown
 * predicate names are rejected at the type level.
 *
 * Also pins evaluator behavior: the default `commitFormat` predicate
 * exported from `./plugin.ts` (built over `BUILTIN_FORMATS`) fires
 * the rule when a required format is missing and stays quiet when
 * all required formats match.
 *
 * If the typecheck fence fails, either the registry block was
 * removed / regressed, the predicate name drifted from the
 * registry's key, or the spread shape no longer matches what a rule
 * author would write. If the behavioral fence fails, the predicate's
 * wiring against `BUILTIN_FORMATS` regressed.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PredicateContext, PredicateWord } from "@cad0p/pi-steering";
import { GIT_CLI_DESCRIPTOR } from "@cad0p/pi-steering/plugins/git";
import { mockContext } from "@cad0p/pi-steering/testing";
import * as ts from "typescript";
import { commitFormat } from "./plugin.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CF_INDEX_PATH = path.resolve(HERE, "index.ts");
// Resolve pi-steering's type declarations through node_modules (the
// monorepo-era sibling path `../../pi-steering/src/index.ts` no longer
// exists since the 2026-08-10 split).
const PI_STEERING_INDEX_PATH = fileURLToPath(
  new URL("../node_modules/@cad0p/pi-steering/dist/index.js", import.meta.url),
);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  strict: true,
  exactOptionalPropertyTypes: true,
  noEmit: true,
  types: [],
};

function withScratch(suffix: string, fn: (scratchDir: string) => void): void {
  const scratchDir = path.join(
    os.tmpdir(),
    `pi-steering-commit-format-registry-${suffix}-${process.pid}-${Date.now()}`,
  );
  try {
    fn(scratchDir);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

function compile(scratchDir: string, source: string): readonly ts.Diagnostic[] {
  mkdirSync(scratchDir, { recursive: true });
  const scratchFile = path.join(scratchDir, "probe.ts");
  writeFileSync(scratchFile, source);
  const program = ts.createProgram([scratchFile], COMPILER_OPTIONS);
  return [
    ...program.getSemanticDiagnostics(),
    ...program.getSyntacticDiagnostics(),
  ];
}

const IMPORT_HEADER = [
  `import "${CF_INDEX_PATH.replace(/\\/g, "\\\\")}";`,
  `import { defineConfig, type Rule } from "${PI_STEERING_INDEX_PATH.replace(/\\/g, "\\\\")}";`,
  "",
].join("\n");

const RULE_PROLOGUE = [
  '\tname: "x",',
  '\ttool: "bash",',
  '\tcommand: "git",',
  '\treason: "x",',
].join("\n");

function W(value: string): PredicateWord {
  return { value, text: value, rawText: value, pos: 0, end: value.length };
}

/**
 * Build a {@link PredicateContext} for a `git commit` ref carrying
 * the given `-m` value as structured argv — the predicate reads it
 * through the `ctx.command` facade (bound via the git table), the
 * same path the engine binds per ref.
 */
function ctxWithMessage(message: string): PredicateContext {
  return mockContext({
    tool: "bash",
    input: {
      tool: "bash",
      command: `git commit -m "${message}"`,
      basename: "git",
      args: [W("commit"), W("-m"), W(message)],
    },
    descriptors: { git: GIT_CLI_DESCRIPTOR },
  });
}

/** A bare `git commit` ref (editor flow — no `-m`). */
function ctxBareCommit(): PredicateContext {
  return mockContext({
    tool: "bash",
    input: {
      tool: "bash",
      command: "git commit",
      basename: "git",
      args: [W("commit")],
    },
    descriptors: { git: GIT_CLI_DESCRIPTOR },
  });
}

describe("pi-steering-commit-format PiSteeringPredicates registry", () => {
  it('commitFormat accepts `require: ["conventional"]` inside `when:`', () => {
    withScratch("conv-only", (scratchDir) => {
      const source =
        IMPORT_HEADER +
        "const r = {\n" +
        RULE_PROLOGUE +
        '\n\twhen: { subcommand: "commit", commitFormat: { require: ["conventional"] } },\n' +
        "} as const satisfies Rule;\n" +
        "export default defineConfig({ rules: [r] });\n";
      const diagnostics = compile(scratchDir, source);
      assert.deepEqual(
        diagnostics.map((d) =>
          ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        ),
        [],
        'commitFormat with require: ["conventional"] should typecheck',
      );
    });
  });

  it('commitFormat accepts `require: ["conventional", "jira"]` inside `when:`', () => {
    withScratch("conv-jira", (scratchDir) => {
      const source =
        IMPORT_HEADER +
        "const r = {\n" +
        RULE_PROLOGUE +
        '\n\twhen: { subcommand: "commit", commitFormat: { require: ["conventional", "jira"] } },\n' +
        "} as const satisfies Rule;\n" +
        "export default defineConfig({ rules: [r] });\n";
      const diagnostics = compile(scratchDir, source);
      assert.deepEqual(
        diagnostics.map((d) =>
          ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        ),
        [],
        "commitFormat with multiple required formats should typecheck",
      );
    });
  });

  it("rejects unknown predicate names — registry is the source of truth", () => {
    withScratch("unknown-key", (scratchDir) => {
      const source =
        IMPORT_HEADER +
        "const r = {\n" +
        RULE_PROLOGUE +
        '\n\twhen: { subcommand: "commit", thisIsNotARegisteredPredicate: "x" },\n' +
        "} as const satisfies Rule;\n" +
        "export default defineConfig({ rules: [r] });\n";
      const diagnostics = compile(scratchDir, source);
      // Pin to TS2353 ("Object literal may only specify known
      // properties") rather than `length !== 0` so probe-source
      // drift can't silently mask the rejection — a different
      // error code would mean the fence is firing for the wrong
      // reason and needs investigation.
      const tsErrors = diagnostics.filter((d) => d.code === 2353);
      assert.notEqual(
        tsErrors.length,
        0,
        "unknown predicate key should fail to typecheck with TS2353",
      );
    });
  });

  it("rejects typo'd format names in `require:` — BuiltinFormatName narrows the literal union", () => {
    withScratch("typo-format", (scratchDir) => {
      // `conventionnnnnal` is a typo for `conventional`. Without
      // the `BuiltinFormatName` narrowing in the registry block,
      // this would typecheck (FormatName defaults to `string`).
      // With the narrowing, TS rejects it as TS2322 ("Type 'X' is
      // not assignable to type 'Y'").
      const source =
        IMPORT_HEADER +
        "const r = {\n" +
        RULE_PROLOGUE +
        '\n\twhen: { subcommand: "commit", commitFormat: { require: ["conventionnnnnal"] } },\n' +
        "} as const satisfies Rule;\n" +
        "export default defineConfig({ rules: [r] });\n";
      const diagnostics = compile(scratchDir, source);
      const tsErrors = diagnostics.filter((d) => d.code === 2322);
      assert.notEqual(
        tsErrors.length,
        0,
        "typo'd format name should fail to typecheck with TS2322",
      );
    });
  });
});

describe("default commitFormat predicate (BUILTIN_FORMATS wiring)", () => {
  it("does NOT fire on a Conventional commit when only `conventional` is required", async () => {
    const ctx = ctxWithMessage("feat: add login");
    assert.equal(await commitFormat({ require: ["conventional"] }, ctx), false);
  });

  it("fires on a non-Conventional commit when `conventional` is required", async () => {
    const ctx = ctxWithMessage("Update README");
    assert.equal(await commitFormat({ require: ["conventional"] }, ctx), true);
  });

  it("does NOT fire on a JIRA-bracketed commit when only `jira` is required", async () => {
    const ctx = ctxWithMessage("[ABC-123] add login");
    assert.equal(await commitFormat({ require: ["jira"] }, ctx), false);
  });

  it("fires on a Conventional-only commit when `jira` is required", async () => {
    const ctx = ctxWithMessage("feat: add login");
    assert.equal(await commitFormat({ require: ["jira"] }, ctx), true);
  });

  it("does NOT fire on a Conventional + JIRA commit when both are required", async () => {
    const ctx = ctxWithMessage("feat: add login [ABC-123]");
    assert.equal(
      await commitFormat({ require: ["conventional", "jira"] }, ctx),
      false,
    );
  });

  it("fires on a Conventional-only commit when both `conventional` and `jira` are required", async () => {
    const ctx = ctxWithMessage("feat: add login");
    assert.equal(
      await commitFormat({ require: ["conventional", "jira"] }, ctx),
      true,
    );
  });

  it("does NOT fire on a bare `git commit` (no -m, editor mode is out of scope)", async () => {
    const ctx = ctxBareCommit();
    assert.equal(await commitFormat({ require: ["conventional"] }, ctx), false);
  });

  it("does NOT fire on `require: []` (no formats required → no-op)", async () => {
    const ctx = ctxWithMessage("anything");
    assert.equal(await commitFormat({ require: [] }, ctx), false);
  });
});
