# 2-Level Validation Severity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat `validationWarning`/`validationHint` strings with a structured `validation` object carrying severity (`error`|`warning`), and add frontmatter-specific validation.

**Architecture:** Add `severity` field to `DateTimeValidationWarning` → rename to `DateTimeValidationResult`. Store as `task.validation` on Task. `FrontmatterTaskBuilder` calls validator with `isFrontmatter` flag for the new `frontmatter-time-only` rule. `ValidationMenuBuilder` uses severity to pick icon (`alert-circle` vs `alert-triangle`).

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add severity to DateTimeRuleValidator

**Files:**
- Modify: `src/services/parsing/utils/DateTimeRuleValidator.ts`
- Create: `tests/unit/parsing/DateTimeRuleValidator.test.ts`

- [ ] **Step 1: Write failing tests for severity field**

```typescript
import { describe, it, expect } from 'vitest';
import { validateDateTimeRules } from '../../../src/services/parsing/utils/DateTimeRuleValidator';

describe('DateTimeRuleValidator', () => {
    describe('severity classification', () => {
        it('end-before-start returns error severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                endDate: '2026-01-05',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('end-before-start');
        });

        it('cross-midnight returns warning severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '22:00',
                endTime: '06:00',
                endDateImplicit: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('cross-midnight');
        });

        it('same-day-inversion returns error severity', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '14:00',
                endDate: '2026-01-10',
                endTime: '10:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('same-day-inversion');
        });

        it('end-time-without-start returns error severity', () => {
            const result = validateDateTimeRules({
                endTime: '10:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('end-time-without-start');
        });

        it('due-without-date returns error severity', () => {
            const result = validateDateTimeRules({
                due: '14:00',
                endDateImplicit: false,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('error');
            expect(result!.rule).toBe('due-without-date');
        });
    });

    describe('frontmatter-time-only rule', () => {
        it('returns warning when start has time but no date in frontmatter', () => {
            const result = validateDateTimeRules({
                startTime: '09:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('frontmatter-time-only');
        });

        it('returns warning when end has time but no date in frontmatter', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '09:00',
                endTime: '17:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeDefined();
            expect(result!.severity).toBe('warning');
            expect(result!.rule).toBe('frontmatter-time-only');
        });

        it('does not trigger for inline tasks', () => {
            const result = validateDateTimeRules({
                startTime: '09:00',
                endDateImplicit: false,
            });
            // Should match end-time-without-start or nothing, not frontmatter-time-only
            expect(result?.rule).not.toBe('frontmatter-time-only');
        });

        it('does not trigger when dates are present', () => {
            const result = validateDateTimeRules({
                startDate: '2026-01-10',
                startTime: '09:00',
                endDate: '2026-01-10',
                endTime: '17:00',
                endDateImplicit: false,
                isFrontmatter: true,
            });
            expect(result).toBeUndefined();
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/parsing/DateTimeRuleValidator.test.ts`
Expected: FAIL — `severity` property does not exist on result

- [ ] **Step 3: Update DateTimeRuleValidator with severity**

In `src/services/parsing/utils/DateTimeRuleValidator.ts`:

```typescript
import { t } from '../../../i18n';

export interface DateTimeValidationInput {
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    endDateImplicit: boolean;
    implicitStartDate?: string;
    isFrontmatter?: boolean;
}

export interface DateTimeValidationResult {
    severity: 'error' | 'warning';
    rule: 'cross-midnight' | 'same-day-inversion' | 'end-before-start'
        | 'end-time-without-start' | 'due-without-date' | 'frontmatter-time-only';
    message: string;
    hint: string;
}

export function validateDateTimeRules(
    input: DateTimeValidationInput
): DateTimeValidationResult | undefined {
    const effectiveStartDate = input.startDate || input.implicitStartDate;

    // Rule 1: Cross-midnight ambiguity (endDate implicit + endTime < startTime)
    if (effectiveStartDate && input.startTime && input.endTime
        && input.endDateImplicit && input.endTime < input.startTime) {
        return {
            severity: 'warning',
            rule: 'cross-midnight',
            message: t('validation.crossMidnight', {
                endTime: input.endTime, startTime: input.startTime,
            }),
            hint: t('validationHint.crossMidnight'),
        };
    }

    // Rule 2: Same-day time inversion (endDate explicit & same day)
    if (effectiveStartDate && input.startTime && input.endTime && input.endDate
        && effectiveStartDate === input.endDate && input.endTime < input.startTime) {
        return {
            severity: 'error',
            rule: 'same-day-inversion',
            message: t('validation.sameDayInversion', {
                endTime: input.endTime, startTime: input.startTime,
            }),
            hint: t('validationHint.sameDayInversion'),
        };
    }

    // Rule 3: End date before start date
    if (effectiveStartDate && input.endDate && input.endDate < effectiveStartDate) {
        return {
            severity: 'error',
            rule: 'end-before-start',
            message: t('validation.endBeforeStart', {
                endDate: input.endDate, startDate: effectiveStartDate,
            }),
            hint: t('validationHint.endBeforeStart'),
        };
    }

    // Rule 4: End time without start time
    if (input.endTime && !input.startTime) {
        return {
            severity: 'error',
            rule: 'end-time-without-start',
            message: t('validation.endTimeWithoutStart'),
            hint: t('validationHint.endTimeWithoutStart'),
        };
    }

    // Rule 5: Due without date
    if (input.due && !/\d{4}-\d{2}-\d{2}/.test(input.due)) {
        return {
            severity: 'error',
            rule: 'due-without-date',
            message: t('validation.dueWithoutDate'),
            hint: t('validationHint.dueWithoutDate'),
        };
    }

    // Rule 6: Frontmatter time-only (YAML sexagesimal problem)
    if (input.isFrontmatter) {
        const startTimeOnly = input.startTime && !input.startDate;
        const endTimeOnly = input.endTime && !input.endDate;
        if (startTimeOnly || endTimeOnly) {
            return {
                severity: 'warning',
                rule: 'frontmatter-time-only',
                message: t('validation.frontmatterTimeOnly'),
                hint: t('validationHint.frontmatterTimeOnly'),
            };
        }
    }

    return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/parsing/DateTimeRuleValidator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/parsing/utils/DateTimeRuleValidator.ts tests/unit/parsing/DateTimeRuleValidator.test.ts
git commit -m "feat: add severity to DateTimeRuleValidator + frontmatter-time-only rule"
```

---

### Task 2: Replace Task type fields + update i18n

**Files:**
- Modify: `src/types/index.ts` (lines 98-100)
- Modify: `src/i18n/locales/en.json` (lines 403-420)
- Modify: `src/i18n/locales/ja.json` (same structure)

- [ ] **Step 1: Update Task interface in types**

In `src/types/index.ts`, replace lines 98-100:

```typescript
// Before:
    // Parse-time warning shown to users.
    validationWarning?: string;
    validationHint?: string;

// After:
    // Parse-time validation result (error or warning).
    validation?: {
        severity: 'error' | 'warning';
        rule: string;
        message: string;
        hint: string;
    };
```

- [ ] **Step 2: Add i18n keys for frontmatter-time-only**

In `src/i18n/locales/en.json`, in the `"validation"` object add:

```json
"frontmatterTimeOnly": "Time-only value in frontmatter may cause YAML parsing issues."
```

In the `"validationHint"` object add:

```json
"frontmatterTimeOnly": "Add a date (e.g. 2026-01-15T09:00) to avoid YAML sexagesimal interpretation."
```

- [ ] **Step 3: Add Japanese i18n keys**

In `src/i18n/locales/ja.json`, in `"validation"` add:

```json
"frontmatterTimeOnly": "frontmatterに時刻のみの値があると、YAMLの六十進法解釈の問題が起きる可能性があります。"
```

In `"validationHint"` add:

```json
"frontmatterTimeOnly": "日付を追加してください（例: 2026-01-15T09:00）。YAMLの六十進法解釈を避けられます。"
```

- [ ] **Step 4: Build to check for compile errors**

Run: `npm run build`
Expected: Compile errors in files still using `validationWarning`/`validationHint` (TaskScanner, AtNotationParser, ValidationMenuBuilder). This is expected — we fix them in the next tasks.

- [ ] **Step 5: Commit (types + i18n only)**

```bash
git add src/types/index.ts src/i18n/locales/en.json src/i18n/locales/ja.json
git commit -m "feat: replace validationWarning/Hint with structured validation object + i18n"
```

---

### Task 3: Migrate AtNotationParser to new validation field

**Files:**
- Modify: `src/services/parsing/inline/AtNotationParser.ts`

- [ ] **Step 1: Update DateBlockResult interface**

In `src/services/parsing/inline/AtNotationParser.ts`, change the `DateBlockResult` interface (around line 10):

```typescript
// Before:
interface DateBlockResult {
    date: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    validationWarning?: string;
}

// After:
import type { DateTimeValidationResult } from '../utils/DateTimeRuleValidator';

interface DateBlockResult {
    date: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    due?: string;
    validationWarning?: string; // parseDateBlock internal warning (excess separators)
}
```

- [ ] **Step 2: Update parse() method to use task.validation**

In the `parse()` method, replace the validation assignment block (around lines 72-93):

```typescript
// Before:
        let validationWarning: string | undefined;
        let validationHint: string | undefined;

        const dateBlock = this.parseDateBlock(rawContent);
        if (dateBlock) {
            ({ date, startTime, endDate, endTime, due,
               validationWarning } = dateBlock.fields);
            content = dateBlock.content;
        }
        // ...
        const fieldWarning = this.validateDateBlock(date, startTime, endDate, endTime, due);
        if (fieldWarning) {
            validationWarning = fieldWarning.message;
            validationHint = fieldWarning.hint;
        }

        return {
            // ...
            validationWarning,
            validationHint,
            // ...
        };

// After:
        let parseWarning: string | undefined;

        const dateBlock = this.parseDateBlock(rawContent);
        if (dateBlock) {
            ({ date, startTime, endDate, endTime, due,
               validationWarning: parseWarning } = dateBlock.fields);
            content = dateBlock.content;
        }
        // ...
        // Build validation from rule validator or parse warning
        let validation: Task['validation'];
        const ruleResult = this.validateDateBlock(date, startTime, endDate, endTime, due);
        if (ruleResult) {
            validation = ruleResult;
        } else if (parseWarning) {
            validation = {
                severity: 'error',
                rule: 'parse-error',
                message: parseWarning,
                hint: '',
            };
        }

        return {
            // ...
            validation,
            // ... (remove validationWarning, validationHint)
        };
```

- [ ] **Step 3: Update validateDateBlock return type**

The `validateDateBlock` method (around line 211) currently returns `{ message, hint } | undefined`. Change it to return the full result:

```typescript
// Before:
    private validateDateBlock(
        date: string, startTime: string | undefined,
        endDate: string | undefined, endTime: string | undefined,
        due: string | undefined,
    ): { message: string; hint: string } | undefined {
        const result = validateDateTimeRules({
            startDate: date || undefined,
            startTime, endDate, endTime, due,
            endDateImplicit: !endDate,
        });
        if (!result) return undefined;
        return { message: result.message, hint: result.hint };
    }

// After:
    private validateDateBlock(
        date: string, startTime: string | undefined,
        endDate: string | undefined, endTime: string | undefined,
        due: string | undefined,
    ): DateTimeValidationResult | undefined {
        return validateDateTimeRules({
            startDate: date || undefined,
            startTime, endDate, endTime, due,
            endDateImplicit: !endDate,
        });
    }
```

- [ ] **Step 4: Build to verify this file compiles**

Run: `npm run build`
Expected: AtNotationParser compiles. Remaining errors in TaskScanner and ValidationMenuBuilder.

- [ ] **Step 5: Commit**

```bash
git add src/services/parsing/inline/AtNotationParser.ts
git commit -m "refactor: migrate AtNotationParser to structured validation"
```

---

### Task 4: Migrate TaskScanner

**Files:**
- Modify: `src/services/core/TaskScanner.ts` (around line 149)

- [ ] **Step 1: Update validation warning collection**

```typescript
// Before:
        for (const task of allExtractedTasks) {
            if (task.validationWarning) {
                this.validator.addError({
                    file: file.path,
                    line: task.line + 1,
                    taskId: task.id,
                    error: task.validationWarning,
                });
            }
        }

// After:
        for (const task of allExtractedTasks) {
            if (task.validation) {
                this.validator.addError({
                    file: file.path,
                    line: task.line + 1,
                    taskId: task.id,
                    error: task.validation.message,
                });
            }
        }
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Remaining error only in ValidationMenuBuilder.

- [ ] **Step 3: Commit**

```bash
git add src/services/core/TaskScanner.ts
git commit -m "refactor: migrate TaskScanner to task.validation"
```

---

### Task 5: Add validation to FrontmatterTaskBuilder

**Files:**
- Modify: `src/services/parsing/file/FrontmatterTaskBuilder.ts`
- Modify: `tests/unit/parsing/FrontmatterTaskBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/parsing/FrontmatterTaskBuilder.test.ts`:

```typescript
        describe('validation', () => {
            it('sets warning for time-only start in frontmatter', () => {
                // normalizeYamlDate converts number 540 (sexagesimal 09:00) to "540"
                // but a string "09:00" stays as "09:00" → parseDateTimeField sees time only
                const fm = { [keys.start]: '09:00' };
                const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
                expect(result).not.toBeNull();
                expect(result!.task.validation).toBeDefined();
                expect(result!.task.validation!.severity).toBe('warning');
                expect(result!.task.validation!.rule).toBe('frontmatter-time-only');
            });

            it('sets error for end-before-start', () => {
                const fm = {
                    [keys.start]: '2026-01-15',
                    [keys.end]: '2026-01-10',
                };
                const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
                expect(result).not.toBeNull();
                expect(result!.task.validation).toBeDefined();
                expect(result!.task.validation!.severity).toBe('error');
                expect(result!.task.validation!.rule).toBe('end-before-start');
            });

            it('no validation for valid dates', () => {
                const fm = {
                    [keys.start]: '2026-01-15T09:00',
                    [keys.end]: '2026-01-15T17:00',
                };
                const result = FrontmatterTaskBuilder.parse('file.md', fm, [], 0, keys, defaultHeader, defaultHeaderLevel);
                expect(result).not.toBeNull();
                expect(result!.task.validation).toBeUndefined();
            });
        });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/parsing/FrontmatterTaskBuilder.test.ts`
Expected: FAIL — `validation` is undefined (no validation call in builder)

- [ ] **Step 3: Add validation call to FrontmatterTaskBuilder**

In `src/services/parsing/file/FrontmatterTaskBuilder.ts`, add import at top:

```typescript
import { validateDateTimeRules } from '../utils/DateTimeRuleValidator';
```

After line 143 (`const isContainer = !hasDateFields;`), before the return statement, add:

```typescript
        // Validate date/time constraints
        const validation = hasDateFields
            ? validateDateTimeRules({
                startDate: start.date || undefined,
                startTime: start.time,
                endDate: end.date || undefined,
                endTime: end.time,
                due,
                endDateImplicit: !end.date,
                isFrontmatter: true,
            }) ?? undefined
            : undefined;
```

Then in the returned task object (around line 147), add the `validation` field:

```typescript
            task: {
                // ... existing fields ...
                isContainer,
                validation,
            },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/parsing/FrontmatterTaskBuilder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/parsing/file/FrontmatterTaskBuilder.ts tests/unit/parsing/FrontmatterTaskBuilder.test.ts
git commit -m "feat: add validation to FrontmatterTaskBuilder with frontmatter-time-only rule"
```

---

### Task 6: Update ValidationMenuBuilder

**Files:**
- Modify: `src/interaction/menu/builders/ValidationMenuBuilder.ts`

- [ ] **Step 1: Update to use task.validation with severity-based icons**

```typescript
import { Menu } from 'obsidian';
import { Task } from '../../../types';

export class ValidationMenuBuilder {
    addValidationWarning(menu: Menu, task: Task): void {
        if (!task.validation) return;

        const icon = task.validation.severity === 'error'
            ? 'alert-circle'
            : 'alert-triangle';
        const cssClass = task.validation.severity === 'error'
            ? 'tv-menu-validation-error'
            : 'tv-menu-validation-warning';

        menu.addItem((item) => {
            item.setTitle(task.validation!.message)
                .setIcon(icon)
                .setDisabled(true);
            if (item.dom) {
                item.dom.addClass(cssClass);
            }
        });
        if (task.validation.hint) {
            menu.addItem((item) => {
                item.setTitle(task.validation!.hint)
                    .setIcon('lightbulb')
                    .setDisabled(true);
                if (item.dom) {
                    item.dom.addClass(cssClass);
                }
            });
        }
        menu.addSeparator();
    }
}
```

- [ ] **Step 2: Build to verify everything compiles**

Run: `npm run build`
Expected: PASS — no compile errors

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/interaction/menu/builders/ValidationMenuBuilder.ts
git commit -m "feat: differentiate validation error/warning icons in context menu"
```

---

### Task 7: Final build verification + cleanup

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 2: Grep for any remaining references to old fields**

Run: `grep -r "validationWarning\|validationHint" src/` — should return zero matches.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Final commit if any cleanup needed**
