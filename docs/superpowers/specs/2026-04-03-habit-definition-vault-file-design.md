# Habit Definition Vault File Migration

## Context

Habit definitions are currently stored in `data.json` (plugin settings). Since the user's vault sync (couchsync) intentionally does not auto-sync `data.json`, habit definitions can drift between devices. Moving definitions to a vault file resolves this by making them part of the synced content.

## Design

### File Format

Path configurable via `habitDefinitionFile` setting (default: `Templates/Habits/habits.md`).

```markdown
---
_tv-type: habits
---

```json
[
  { "name": "water", "type": "number", "unit": "cups" },
  { "name": "exercise", "type": "boolean" },
  { "name": "reading", "type": "number", "unit": "pages" }
]
```
```

Follows the existing template pattern (frontmatter + JSON code block) used by `Templates/Timers` and `Templates/Views`.

### Architecture

#### New Files

| File | Purpose |
|------|---------|
| `src/services/template/HabitDefinitionLoader.ts` | Read habits from vault md file |
| `src/services/template/HabitDefinitionWriter.ts` | Write habits to vault md file |
| `src/suggest/DailyNoteFrontmatterSuggest.ts` | Suggest frontmatter keys from daily notes |

#### Modified Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `habitDefinitionFile: string` to settings |
| `src/settings/HabitsTab.ts` | File path setting + suggest integration + save to vault file |
| `src/main.ts` | Load habits from vault file on startup + migration |

#### Unchanged

| File | Reason |
|------|--------|
| `src/views/sharedUI/HabitTrackerRenderer.ts` | Reads from `settings.habits` — no change needed |

### Data Flow

```
Startup:
  main.ts → HabitDefinitionLoader.load(filePath)
         → settings.habits = parsed definitions
         → (migration: if data.json has habits && no habits.md → create habits.md, remove from data.json)

Settings UI edit:
  HabitsTab → settings.habits updated in memory
           → HabitDefinitionWriter.save(filePath, settings.habits)
           → refreshAllViews()
```

### Settings UI (HabitsTab)

- Existing habit editing UI preserved (name, type, unit, add, remove)
- New: file path setting for `habitDefinitionFile`
- New: name input suggests daily note frontmatter keys with auto-detected type
  - Sources: Daily Notes template file (priority) + recent daily notes
  - Type inference: `true`/`false` → boolean, number → number, else → string
  - Uses `AbstractInputSuggest` pattern (consistent with existing PropertyColorSuggest)

### HabitDefinitionLoader

```typescript
class HabitDefinitionLoader {
  load(filePath: string): HabitDefinition[]
  // Uses vault.cachedRead() + JSON extraction (same pattern as ViewTemplateLoader)
}
```

### HabitDefinitionWriter

```typescript
class HabitDefinitionWriter {
  save(filePath: string, habits: HabitDefinition[]): Promise<TFile>
  // Uses vault.modify() or vault.create() (same pattern as ViewTemplateWriter)
  // Auto-creates parent folders if needed
}
```

### DailyNoteFrontmatterSuggest

```typescript
class DailyNoteFrontmatterSuggest extends AbstractInputSuggest<{name: string, type: HabitType}> {
  // Collects frontmatter keys from:
  // 1. Daily Notes template file (via Daily Notes plugin settings)
  // 2. Recent daily notes (scan a few recent ones via metadataCache)
  // Infers type from values
  // Excludes keys already defined as habits
}
```

### Migration (temporary — remove next release)

On plugin load:
1. Check if `settings.habits` has entries in data.json
2. Check if habits.md does NOT exist at configured path
3. If both true: create habits.md from data.json habits, then delete `habits` from settings and save

### Vault File Sync

When habits.md is modified externally (e.g., synced from another device):
- Listen for `vault.on('modify')` on the habits file
- Reload definitions into `settings.habits`
- Trigger `refreshAllViews()`
