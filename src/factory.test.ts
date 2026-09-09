// SPDX-License-Identifier: MIT
// Part of pi-steering-commit-format.

/**
 * Tests for `commitFormatFactory`.
 *
 * AND semantics across multiple required formats; defensive
 * `!checker` arm fires (force via `as any` cast); empty `require`
 * array returns false (silent-pass per the no-formats-required =
 * no-op convention); missing `-m` returns false.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext, PredicateWord } from "@cad0p/pi-steering";
import { GIT_CLI_DESCRIPTOR } from "@cad0p/pi-steering/plugins/git";
import { mockContext } from "@cad0p/pi-steering/testing";
import { BUILTIN_FORMATS } from "./builtin-formats.ts";
import { type CommitFormatArgs, commitFormatFactory } from "./factory.ts";

function W(value: string): PredicateWord {
  return { value, text: value, rawText: value, pos: 0, end: value.length };
}

/**
 * Build a {@link PredicateContext} for a `git commit` ref carrying
 * the given `-m` values as structured argv — the predicate reads
 * them through the `ctx.command` facade (bound via the git table),
 * the same path the engine binds per ref. One word per message, as
 * the walker emits for quoted `-m "..."` values.
 */
function ctxWithMessages(...messages: string[]): PredicateContext {
  const args: PredicateWord[] = [W("commit")];
  for (const m of messages) args.push(W("-m"), W(m));
  const command = `git commit${messages.map((m) => ` -m "${m}"`).join("")}`;
  return mockContext({
    tool: "bash",
    input: { tool: "bash", command, basename: "git", args },
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

describe("commitFormatFactory — AND semantics", () => {
  it("fires when ALL required formats fail", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxWithMessages("Update README");
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, ctx),
      true,
    );
  });

  it("fires when ONE of two required formats fails", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    // Conventional but no JIRA reference → fire.
    const ctx = ctxWithMessages("feat: add login");
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, ctx),
      true,
    );
  });

  it("does NOT fire when ALL required formats pass", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxWithMessages("feat: add login [ABC-123]");
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, ctx),
      false,
    );
  });

  it("does NOT fire when the only required format passes", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxWithMessages("feat: add login");
    assert.equal(await handler({ require: ["conventional"] }, ctx), false);
  });
});

describe("commitFormatFactory — defensive bypass", () => {
  it("fires when require contains a name not in the formats map (`as any` bypass)", async () => {
    // Type-correct callers can't reach this branch — the generic
    // narrows `require` to `keyof F`. JS callers (or `as any` casts)
    // that pass an unknown format name should fail-CLOSED, not
    // silently pass.
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxWithMessages("feat: add login [ABC-123]");
    const args = {
      require: ["conventional", "nonexistent"],
    } as unknown as CommitFormatArgs<"conventional" | "jira">;
    assert.equal(await handler(args, ctx), true);
  });
});

describe("commitFormatFactory — empty require", () => {
  it("returns false when `require: []` (no formats required)", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxWithMessages("feat: add login");
    assert.equal(await handler({ require: [] }, ctx), false);
  });
});

describe("commitFormatFactory — missing -m", () => {
  it("returns false when the command has no -m (editor flow)", async () => {
    // Bare `git commit` opens an editor for the message; this
    // predicate doesn't validate that flow. Fail-OPEN here keeps
    // the predicate from blocking every editor commit silently;
    // pair with a separate hook if you want to gate on editor
    // commits.
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = ctxBareCommit();
    assert.equal(await handler({ require: ["conventional"] }, ctx), false);
  });
});

describe("commitFormatFactory — custom format extension", () => {
  it("AND-gates a custom format alongside the builtins", async () => {
    // Worked example of the spread-extension pattern. Pin that
    // custom checkers see the message verbatim and AND with the
    // builtins.
    const customHandler = commitFormatFactory({
      ...BUILTIN_FORMATS,
      custom: (msg) => /^\[CUSTOM\]/.test(msg),
    });

    const passing = ctxWithMessages("[CUSTOM] feat: add login [ABC-123]");
    // Doesn't pass conventional (`[CUSTOM] ...` doesn't match the
    // `feat:` header), so this fires.
    assert.equal(
      await customHandler({ require: ["custom", "conventional"] }, passing),
      true,
    );

    // Custom-only requirement passes when the prefix matches.
    const customOnly = ctxWithMessages("[CUSTOM] anything goes");
    assert.equal(
      await customHandler({ require: ["custom"] }, customOnly),
      false,
    );
  });
});

describe("commitFormatFactory — structured -m/--message extraction", () => {
  it("concatenates repeated -m with a blank line (git join rule)", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    // Split across two `-m` values: the header satisfies
    // `conventional`, the body carries the JIRA reference — joined
    // with `"\n\n"` both pass, so the rule stays quiet.
    const split = ctxWithMessages("feat: add login", "[ABC-123]");
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, split),
      false,
    );
    // Same header alone still fires when `jira` is required.
    const single = ctxWithMessages("feat: add login");
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, single),
      true,
    );
  });

  it("reads the `--message` long form", async () => {
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = mockContext({
      tool: "bash",
      input: {
        tool: "bash",
        command: `git commit --message "feat: add login"`,
        basename: "git",
        args: [W("commit"), W("--message"), W("feat: add login")],
      },
      descriptors: { git: GIT_CLI_DESCRIPTOR },
    });
    assert.equal(await handler({ require: ["conventional"] }, ctx), false);
  });

  it("binds a separated -m to one token (git-faithful, unquoted)", async () => {
    // Unquoted `git commit -m feat: add login` binds `-m` to `"feat:"`
    // under every real parser — the message is `"feat:"`, which
    // matches no format, so the rule fires fail-closed.
    const handler = commitFormatFactory(BUILTIN_FORMATS);
    const ctx = mockContext({
      tool: "bash",
      input: {
        tool: "bash",
        command: "git commit -m feat: add login",
        basename: "git",
        args: [W("commit"), W("-m"), W("feat:"), W("add"), W("login")],
      },
      descriptors: { git: GIT_CLI_DESCRIPTOR },
    });
    assert.equal(await handler({ require: ["conventional"] }, ctx), true);
  });
});
