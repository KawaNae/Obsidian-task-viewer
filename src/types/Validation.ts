/**
 * The code spaces a task's validation error can come from. No imports by
 * design: every other type file may depend on this one.
 */
/**
 * Date/time constraint rules emitted by DateTimeRuleValidator (the
 * canonical list — the validator's result type references this union).
 */
export type DateTimeRule =
    | 'cross-midnight' | 'same-day-inversion' | 'end-before-start'
    | 'end-time-without-start' | 'due-without-date' | 'frontmatter-time-only';

/**
 * Lang/flow diagnostic codes (Diagnostic.code): namespaced by layer.
 * The prefixes keep this space disjoint from DateTimeRule, which the
 * validation-freshness logic in TreeTaskExtractor relies on when clearing
 * stale flow-origin validations.
 */
export type DiagnosticCode = `${'flow' | 'lex' | 'expr' | 'type'}.${string}`;

/**
 * The three code spaces that may appear in Task.validation.rule:
 * date/time constraint rules, the @block parse error, and joined-flow
 * diagnostics.
 */
export type ValidationRule = DateTimeRule | 'parse-error' | DiagnosticCode;
