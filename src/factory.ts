// SPDX-License-Identifier: MIT
// Part of pi-steering-commit-format.

import type { PredicateContext, PredicateHandler } from "@cad0p/pi-steering";
import { GIT_CLI_DESCRIPTOR } from "@cad0p/pi-steering/plugins/git";

/** Git `commit` message entries, referenced by variable from the owning table. */
const { flags: gitFlags } = GIT_CLI_DESCRIPTOR;

/**
 * A format checker takes a commit message and reports whether it
 * matches the format. Plug into {@link commitFormatFactory} as one
 * key in the formats map.
 */
export type FormatChecker = (message: string) => boolean;

/**
 * Argument shape for the `commitFormat` predicate.
 *
 * `require` lists the format names the message must satisfy. AND
 * semantics across formats — every listed format must match.
 *
 * The generic `FormatName` parameter is narrowed at the call site to
 * `keyof F & string` (where `F` is the formats map passed to
 * {@link commitFormatFactory}), so TypeScript can flag typos at the
 * rule's `when:` slot.
 */
export interface CommitFormatArgs<FormatName extends string = string> {
  /** All listed formats must match (AND semantics). */
  require: readonly FormatName[];
}

/**
 * Construct a `commitFormat` predicate that validates against a
 * configurable format set. Use the default plugin's `commitFormat`
 * for the conventional + jira preset; use `commitFormatFactory` to
 * compose custom format sets including third-party formats.
 *
 * Behavior on bypass: a JS caller (or `as any` cast) supplying a
 * format name not in `F`'s keys hits the `!checker` arm and FIRES
 * (defensive fail-closed, consistent with engine semantics).
 * Type-system-correct callers cannot reach this branch — the generic
 * `keyof F & string` narrows `args.require` at the type level.
 *
 * Message source: every `-m` / `--message` value via the
 * context-provided `ctx.command` facade (`getAllFlagValues` over
 * the git table's `message` entry — quote-aware, no string scans),
 * joined with git's `"\n\n"` concat rule for repeats (join policy
 * is owned here, not by core). Both spellings are covered — the old
 * string scan only saw `-m`. An attached-empty `--message=` yields
 * an explicit empty message (core scalar/array contract); an empty
 * joined message matches no format, so the rule fires fail-closed
 * when formats are required.
 *
 * Behavior on missing `-m`: the predicate returns `false` (rule
 * doesn't fire) when the command carries no `-m` / `--message`
 * value. A bare `git commit` opens an editor for the message,
 * which this predicate doesn't validate; pair with a separate hook
 * if you need to gate on editor commits.
 *
 * Behavior on empty `require: []`: returns `false` (no formats
 * required → nothing fires). Silent-pass per the no-formats =
 * no-op convention.
 *
 * @example
 * ```ts
 * import { commitFormatFactory, BUILTIN_FORMATS } from "@cad0p/pi-steering-commit-format";
 *
 * // Use the builtins as-is:
 * const commitFormat = commitFormatFactory(BUILTIN_FORMATS);
 *
 * // Or extend with a custom format:
 * const myCommitFormat = commitFormatFactory({
 *   ...BUILTIN_FORMATS,
 *   custom: (msg) => /^\[CUSTOM\]/.test(msg),
 * });
 * ```
 */
export function commitFormatFactory<F extends Record<string, FormatChecker>>(
  formats: F,
): PredicateHandler<CommitFormatArgs<keyof F & string>> {
  return async (args, ctx: PredicateContext) => {
    const msg = ctx.command.getAllFlagValues([gitFlags.message]).join("\n\n");
    if (!msg) return false; // no -m to validate
    for (const fmt of args.require) {
      const checker = formats[fmt];
      // Defensive: typed callers never hit `!checker`; guards JS / as-any bypass.
      if (!checker?.(msg)) return true; // fire: format missing
    }
    return false;
  };
}
