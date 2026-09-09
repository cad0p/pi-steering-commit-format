// SPDX-License-Identifier: MIT
// Part of pi-steering-commit-format.

/**
 * Tests for the default `commitFormatPlugin`.
 *
 * Pin: registers under name `"commit-format"`; `commitFormat`
 * predicate accepts `["conventional", "jira"]` and validates correctly
 * via the registered registry.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PredicateContext, PredicateWord } from "@cad0p/pi-steering";
import { GIT_CLI_DESCRIPTOR } from "@cad0p/pi-steering/plugins/git";
import { mockContext } from "@cad0p/pi-steering/testing";
import { commitFormatPlugin } from "./plugin.ts";

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

describe("commitFormatPlugin", () => {
  it("registers under the name `commit-format`", () => {
    assert.equal(commitFormatPlugin.name, "commit-format");
  });

  it("exposes a `commitFormat` predicate", () => {
    assert.ok(
      "commitFormat" in commitFormatPlugin.predicates,
      "plugin must register a `commitFormat` predicate",
    );
    assert.equal(typeof commitFormatPlugin.predicates.commitFormat, "function");
  });

  it("validates a Conventional + JIRA commit (no fire)", async () => {
    const ctx = ctxWithMessage("feat: add login [ABC-123]");
    const handler = commitFormatPlugin.predicates.commitFormat;
    assert.equal(
      await handler({ require: ["conventional", "jira"] }, ctx),
      false,
    );
  });

  it("fires on a non-Conventional commit", async () => {
    const ctx = ctxWithMessage("Update README");
    const handler = commitFormatPlugin.predicates.commitFormat;
    assert.equal(await handler({ require: ["conventional"] }, ctx), true);
  });

  it("fires on a Conventional commit without a JIRA reference", async () => {
    const ctx = ctxWithMessage("feat: add login");
    const handler = commitFormatPlugin.predicates.commitFormat;
    assert.equal(await handler({ require: ["jira"] }, ctx), true);
  });
});
