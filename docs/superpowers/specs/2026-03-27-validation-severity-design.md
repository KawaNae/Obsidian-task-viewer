# 2-Level Validation Severity System

## Context

DateTimeRuleValidator currently returns a flat `DateTimeValidationWarning` with `message` + `hint`, stored on Task as two separate optional strings (`validationWarning`, `validationHint`). All rules are treated equally -- no distinction between errors (user must fix) and warnings (parser can handle, but the value is fragile).

Additionally, frontmatter tasks have NO validation: `FrontmatterTaskBuilder.parse()` skips validation entirely. Frontmatter has a unique problem: time-only values like `09:00` are interpreted as YAML sexagesimal numbers (540), making round-trips fragile. This should be flagged as a warning.

## Design

### Task type change

Replace two flat fields with a structured object:

```typescript
// Before
validationWarning?: string;
validationHint?: string;

// After
validation?: {
    severity: 'error' | 'warning';
    rule: string;
    message: string;
    hint: string;
};
```

### Rule severity classification

| Rule | Severity | Reason |
|------|----------|--------|
| `end-before-start` | error | Logically invalid, parser cannot fix |
| `same-day-inversion` | error | Ambiguous intent, user must clarify |
| `end-time-without-start` | error | Missing required context |
| `due-without-date` | error | Invalid due format |
| `cross-midnight` | warning | Parser adds +1 day, but intent may differ |
| `frontmatter-time-only` | **warning** (NEW) | YAML sexagesimal problem; works but fragile |

### DateTimeRuleValidator changes

- Add `severity: 'error' | 'warning'` to `DateTimeValidationWarning` interface
- Each rule return includes its severity
- Rename interface to `DateTimeValidationResult` (no longer always a "warning")
- Add `frontmatter-time-only` to the rule union type

### New rule: `frontmatter-time-only`

- **Trigger**: `parserId === 'frontmatter'` and start/end has time but no date
- **Implementation**: Add optional `isFrontmatter` flag to `DateTimeValidationInput`, or validate in `FrontmatterTaskBuilder` and pass result separately
- **Recommended**: Add `isFrontmatter?: boolean` to input, check in `validateDateTimeRules()`

### FrontmatterTaskBuilder integration

- Call `validateDateTimeRules()` after date fields are parsed
- Pass `isFrontmatter: true` in input
- Set `task.validation` from result

### ValidationMenuBuilder changes

- Read from `task.validation` instead of `task.validationWarning` / `task.validationHint`
- Icon by severity:
  - `error` -> `alert-circle`
  - `warning` -> `alert-triangle`
- Hint icon remains `lightbulb` for both
- CSS class: `tv-menu-validation-error` or `tv-menu-validation-warning` based on severity

### Consumer migration

Files that reference `validationWarning` / `validationHint`:

| File | Change |
|------|--------|
| `src/types/index.ts` | Replace fields with `validation?` |
| `src/services/parsing/utils/DateTimeRuleValidator.ts` | Add severity to interface + returns, add `frontmatter-time-only` rule |
| `src/services/core/TaskScanner.ts` | Write to `task.validation` instead of `task.validationWarning/Hint` |
| `src/services/parsing/inline/AtNotationParser.ts` | Same |
| `src/services/parsing/file/FrontmatterTaskBuilder.ts` | Add validation call |
| `src/interaction/menu/builders/ValidationMenuBuilder.ts` | Read from `task.validation`, icon by severity |
| `src/i18n/locales/en.json` | Add `frontmatter-time-only` messages |
| `src/i18n/locales/ja.json` | Add `frontmatter-time-only` messages |

## Verification

1. `npm run build` passes
2. Inline task with cross-midnight -> warning icon (alert-triangle) in context menu
3. Inline task with end-before-start -> error icon (alert-circle) in context menu
4. Frontmatter task with `tv-start: 09:00` (time-only) -> warning icon in context menu
5. Frontmatter task with valid dates -> no validation shown
6. Hint (lightbulb) still appears for both error and warning
