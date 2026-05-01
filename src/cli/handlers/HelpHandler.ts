import type { CliData } from 'obsidian';

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
  help               Show this reference

Run "obsidian help obsidian-task-viewer:<command>" for each command's flags.

Common Flags
------------
  format=json|tsv|jsonl    Output format (default: json)
  outputFields=key,key,... Output fields (default: id only)
    Available fields:
      id, file, line, content, status, startDate, startTime, endDate, endTime,
      due, tags, parserId, parentId, childIds, color, linestyle,
      effectiveStartDate, effectiveStartTime, effectiveEndDate, effectiveEndTime,
      durationMinutes, properties

Date Formats
------------
  Absolute:  YYYY-MM-DD (e.g. 2026-03-15)
  Datetime:  YYYY-MM-DD HH:mm (e.g. 2026-03-15 14:00)
  Time only: HH:mm (e.g. 14:00, inherits date from context)
  Presets:   today, thisWeek, pastWeek, nextWeek, thisMonth, thisYear,
             next7days, next30days

Sort
----
  sort=property[:direction],... (e.g. startDate:asc,due:desc)
  Properties: content, due, startDate, endDate, file, status, tag
  Direction:  asc (default), desc

Boolean Flags
-------------
  leaf, root — specify flag name only to enable (e.g. "leaf", not "leaf=true")

list: Filter Flags
------------------
  file=<path>          File path (.md auto-appended)
  status=<chars>       Status char(s), comma-separated
  tag=<tags>           Tag(s), comma-separated (# auto-stripped, hierarchy match)
  content=<text>       Content partial match
  date=<date|preset>   Tasks active on date (cannot combine with from/to)
  from=<date|preset>   startDate >= value
  to=<date|preset>     endDate <= value
  due=<date|preset>    Due date equals
  leaf                 Only leaf tasks (no children)
  root                 Only root tasks (no parent)
  color=<colors>       Card color(s), comma-separated
  type=<types>         Task notation (taskviewer, tasks, dayplanner)
  property=<key:value> Custom property (e.g. "priority:high")
  filter-file=<path>   FilterState JSON file (.json) or view template (.md)
                       Overrides all simple filter flags above (see below)
  list=<name>          Pinned list name (when filter-file is a .md template)

create: Flags
-------------
  file=<path>          Target file path (.md auto-appended) [required]
  content=<text>       Task content [required]
  start=<date|datetime> Start date/datetime
  end=<date|datetime>  End date/datetime
  due=<YYYY-MM-DD>     Due date
  status=<char>        Status character (default: space)
  heading=<heading>    Insert under heading (default: end of file)

update: Flags
-------------
  id=<taskId>          Task ID [required]
  content=<text>       New content
  start=<date|datetime> New start date/datetime
  end=<date|datetime>  New end date/datetime
  due=<YYYY-MM-DD>     New due date
  status=<char>        New status character

duplicate: Flags
----------------
  id=<taskId>          Task ID [required]
  day-offset=<n>       Days to shift all dates (positive=future, negative=past, default: 0)
  count=<n>            Number of copies to create (default: 1)

convert: Flags
--------------
  id=<taskId>          Task ID [required]
                       Converts the tv-inline task to a new tv-file (frontmatter) task.
                       Returns the path of the newly created file.

categorized-tasks-for-date-range: Flags
---------------------------------------
  start=<YYYY-MM-DD>  Start date (inclusive) [required]
  end=<YYYY-MM-DD>    End date (inclusive) [required]
                      Returns { "YYYY-MM-DD": { allDay: [...], timed: [...], dueOnly: [...] }, ... }

insert-child-task: Flags
------------------------
  parent-id=<taskId> Parent task ID [required]
  content=<text>     Child task content [required]
                     Inserts a new child task (- [ ] content) under the parent.

create-tv-file: Flags
---------------------
  content=<text>       Task content [required]
  start=<date|datetime> Start date/datetime
  end=<date|datetime>  End date/datetime
  due=<YYYY-MM-DD>     Due date
  status=<char>        Status character (default: space)
                       Creates a new tv-file (frontmatter) task. Returns the new file path.

get-start-hour: Flags
---------------------
  (no flags)           Returns the current startHour setting (visual day boundary).

tasks-for-date-range: Flags
---------------------------
  start=<YYYY-MM-DD>   Start date (inclusive) [required]
  end=<YYYY-MM-DD>     End date (inclusive) [required]
  sort=<prop[:dir],..> Sort (e.g. startDate:asc,due:desc)
  limit=<number>       Max results
  offset=<number>      Skip first N results
  format=json|tsv|jsonl Output format (default: json)
  outputFields=<key,..> Output fields (default: id only)
                       Includes tasks whose effective start..end range overlaps [start, end].
                       Due-only tasks (no start/end) are included if due falls in range.

filter-file: File-based Filtering
==================================

The filter-file flag loads a filter from a file in the vault.
Two file types are supported:

  .json — Raw FilterState JSON (standard JSON with double quotes).
  .md   — View template saved from the plugin UI.

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
