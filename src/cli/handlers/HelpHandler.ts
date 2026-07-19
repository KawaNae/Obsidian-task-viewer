import type { CliData } from 'obsidian';
import {
    renderFlagTable,
    LIST_SCHEMA, CREATE_SCHEMA, UPDATE_SCHEMA, DUPLICATE_SCHEMA, CONVERT_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA, CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA,
    INSERT_CHILD_TASK_SCHEMA, CREATE_TV_FILE_SCHEMA, EXPORT_IMAGE_SCHEMA,
} from '../../api/OperationSchemas';

// Per-command flag tables are generated from OperationSchemas (the same
// source as the actual flag declarations); the surrounding prose is
// hand-written.
const HELP_TEXT = `
Task Viewer CLI Reference
=========================

Commands
--------
  list               List tasks with filters, sort, and pagination
  today              List tasks active today (visual-date aware)
  get                Get a single task by ID
  create             Create a new inline task
  update             Update an existing task
  delete             Delete a task
  duplicate          Duplicate a task with optional date shifting
  convert            Convert a tv-inline task to a tv-file (frontmatter) task
  tasks-for-date-range  List tasks overlapping a date range (flat list)
  categorized-tasks-for-date-range  Get tasks in a date range, categorized per date
  insert-child-task     Insert a child task under a parent task
  create-tv-file        Create a new tv-file (frontmatter) task
  get-start-hour        Get the current startHour setting
  export-image          Export a view as a PNG image
  help               Show this reference

Run "obsidian help obsidian-task-viewer:<command>" for each command's flags.

Vocabulary
----------
  from / to        = query window (inclusive overlap). A task matches when
                     its span intersects [from, to].
  date             = single-day window, sugar for from=X to=X
  start / end / due = the task's own fields (create / update / create-tv-file)

  Unknown flags are errors (with a did-you-mean suggestion) — they are
  never silently ignored.

Common Flags
------------
  format=json|tsv|jsonl        Output format (default: json)
  output-fields=key,key,...    Output fields (default: id only)
    Available fields:
      id, file, line, content, status, startDate, startTime, endDate, endTime,
      due, tags, parserId, parentId, childIds, color, linestyle,
      effectiveStartDate, effectiveStartTime, effectiveEndDate, effectiveEndTime,
      effectiveDue, durationMinutes, properties, flow

Date Formats
------------
  Absolute:  YYYY-MM-DD (e.g. 2026-03-15)
  Datetime:  YYYY-MM-DD HH:mm (e.g. 2026-03-15 14:00)
  Time only: HH:mm (e.g. 14:00, inherits date from context)
  Presets:   today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear,
             next7days, next30days
             (usable on all window flags: date, from, to, due — including
              the range commands)

Sort
----
  sort=property[:direction],... (e.g. startDate:asc,due:desc)
  Properties: content, due, startDate, endDate, file, status, tag
  Direction:  asc (default), desc

Boolean Flags
-------------
  leaf, root — boolean flags: pass the name alone ("leaf") or with "=true" ("leaf=true")

list: Filter Flags
------------------
${renderFlagTable(LIST_SCHEMA)}

  Window note: list's from/to window matches against the task's effective
  (calendar) dates and excludes due-only tasks; the range commands below
  use the visual (startHour-adjusted) window and include due-only tasks,
  mirroring the timeline rendering.

create: Flags
-------------
${renderFlagTable(CREATE_SCHEMA)}

update: Flags
-------------
${renderFlagTable(UPDATE_SCHEMA)}

duplicate: Flags
----------------
${renderFlagTable(DUPLICATE_SCHEMA)}

convert: Flags
--------------
${renderFlagTable(CONVERT_SCHEMA)}
                       Converts the tv-inline task to a new tv-file (frontmatter) task.
                       Returns the path of the newly created file.

tasks-for-date-range: Flags
---------------------------
${renderFlagTable(TASKS_FOR_DATE_RANGE_SCHEMA, { output: true })}
                       Includes tasks whose visual span overlaps [from, to].
                       Due-only tasks (no start/end) are included if due falls in range.

categorized-tasks-for-date-range: Flags
---------------------------------------
${renderFlagTable(CATEGORIZED_TASKS_FOR_DATE_RANGE_SCHEMA)}
                      Returns { "YYYY-MM-DD": { allDay: [...], timed: [...], dueOnly: [...] }, ... }
                      allDay/timed membership follows the visual span; dueOnly
                      follows the calendar due date.

insert-child-task: Flags
------------------------
${renderFlagTable(INSERT_CHILD_TASK_SCHEMA)}
                     Inserts a new child task (- [ ] content) under the parent.

create-tv-file: Flags
---------------------
${renderFlagTable(CREATE_TV_FILE_SCHEMA)}
                       Creates a new tv-file (frontmatter) task. Returns the new file path.

get-start-hour: Flags
---------------------
  (no flags)           Returns the current startHour setting (visual day boundary).

export-image: Flags
-------------------
${renderFlagTable(EXPORT_IMAGE_SCHEMA)}
  Exports a view as a PNG image at 2× pixel ratio.
  Returns { path, width, height, captureDurationMs, totalDurationMs }.

  Supported views: timeline, calendar, schedule, kanban.
  Note: very large calendars (thousands of task cards) may exceed rendering limits.

  Modes:
    view=timeline                        Captures the currently open view (must be visible).
    view=timeline start-date=2026-07-14  Opens a temporary tab, renders with the given
                                         config, captures, and closes it.

  View-config flags (vary per view — use an unknown flag to see the list):
    timeline : start-date=, days-to-show=, zoom-level=, show-all-day=, mask-mode=, ...
    calendar : window-start=, mask-mode=, ...
    schedule : current-date=, mask-mode=, ...
    kanban   : mask-mode=, ...

  Behavior:
    - Default filename: {name or template or viewType}_{YYYY-MM-DD}.png
    - Same-day re-export overwrites (deterministic, idempotent).
    - width/height in the result are CSS pixels of the expanded content.
      Actual PNG is width×2 × height×2 (pixelRatio=2), clamped to 16384px max
      canvas dimension (tall views may be proportionally scaled down).
    - Capture results depend on the current tab width.
    - wait= and keep-open apply to temporary-tab mode only.
    - keep-open leaves are placed in a non-active tab group
      (use split-walk, not iterateAllLeaves, to find them).
    - Flags use key=value syntax only (--flag is not supported).

filter-file: File-based Filtering
==================================

The filter-file flag loads a filter from a file in the vault.
Two file types are supported:

  .json — Raw FilterState JSON (standard JSON with double quotes).
  .md   — View template saved from the plugin UI.

Filter files are validated on load: an unknown property or an operator
not valid for its property is an error (see the reference below).

.json files
-----------
Create a JSON file anywhere in your vault containing a FilterState object:

  {
    "logic": "and",
    "filters": [
      { "property": "tag", "operator": "equals", "value": ["work"] }
    ]
  }

  obsidian obsidian-task-viewer:list filter-file=filters/exact-tag.json

.md view templates
------------------
Use a view template saved from the plugin's "Save view..." menu.
Templates can contain a view-level filter and/or pinned lists.

  No pinned lists — applies the view filter directly:
    obsidian obsidian-task-viewer:list filter-file=templates/work.md

  With pinned lists — specify which list to use with list=<name>:
    obsidian obsidian-task-viewer:list filter-file=templates/work.md list=urgent

  If pinned lists exist but list= is omitted, an error shows available names.

FilterState JSON Reference
==========================

Structure
---------
{
  "logic": "and" | "or",
  "filters": [ <condition | group>, ... ]
}

Condition:
{
  "property": "<property>",
  "operator": "<operator>",
  "value": <value>,
  "target": "parent"       (optional: match against parent/ancestor task)
}

Single condition (shorthand):
  { "property": "tag", "operator": "includes", "value": ["work"] }

Target
------
  Add "target": "parent" to evaluate the condition against the task's
  parent (and ancestors). Useful for filtering tasks whose parent has
  a specific tag, status, etc.

  Example: tasks whose parent has tag "project":
  { "property": "tag", "operator": "includes", "value": ["project"], "target": "parent" }

Groups can be nested up to 3 levels deep.

Properties & Operators
----------------------
  file        : includes, excludes          (value: ["a", "b"])
  tag         : includes (hierarchy), excludes, equals (exact)  (value: ["a"])
  status      : includes, excludes          (value: [" ", "x"])
  content     : contains, notContains       (value: "text")
  startDate   : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  endDate     : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  due         : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  color       : includes, excludes          (value: ["red"])
  linestyle   : includes, excludes          (value: ["dashed"])
  length      : lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual, equals, isSet, isNotSet
  anyDate     : isSet, isNotSet             (any of start/end/due set)
  kind        : includes, excludes          (value: ["inline", "file"])
  notation    : includes, excludes          (value: ["taskviewer", "tasks", "dayplanner"])
  parent      : isSet, isNotSet             (no value)
  children    : isSet, isNotSet             (no value)
  property    : isSet, isNotSet, equals, contains, notContains

Value Types
-----------
  string[]  : ["a", "b"]
              Used by: file, tag, status, color, linestyle, kind, notation

  string    : "search text"
              Used by: content

  date      : "2026-03-15" (absolute)
          or: { "preset": "today" } (relative)
              Used by: startDate, endDate, due

  number    : 60  (with "unit": "minutes" or "hours")
              Used by: length

  property  : "high" (with "key": "priority")
              Used by: property

  (no value): isSet / isNotSet operators need no value

Date Presets
------------
  today, thisWeek, nextWeek, pastWeek, nextNDays (with "n" field), thisMonth, thisYear
`.trim();

export function createHelpHandler() {
    return (_params: CliData): string => {
        return HELP_TEXT;
    };
}
