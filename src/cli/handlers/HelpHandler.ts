import type { CliData } from 'obsidian';

const HELP_TEXT = `
Task Viewer CLI Reference
=========================

Commands
--------
  list          List tasks with filters, sort, and pagination
  today         List tasks active today (visual-date aware)
  get           Get a single task by ID
  create        Create a new inline task
  update        Update an existing task
  delete        Delete a task
  help          Show this reference

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
  type=<types>         Task type (at-notation, frontmatter)
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
    "root": {
      "type": "group",
      "id": "g1",
      "logic": "and",
      "children": [
        {
          "type": "condition",
          "id": "c1",
          "property": "tag",
          "operator": "equals",
          "value": { "type": "stringSet", "values": ["work"] }
        }
      ]
    }
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
  "root": {
    "type": "group",
    "id": "<any-unique-string>",
    "logic": "and" | "or",
    "children": [ <condition | group>, ... ]
  }
}

Condition:
{
  "type": "condition",
  "id": "<any-unique-string>",
  "property": "<property>",
  "operator": "<operator>",
  "value": <value>
}

Groups can be nested up to 3 levels deep.

Properties & Operators
----------------------
  file        : includes, excludes
  tag         : includes (hierarchy match), excludes, equals (exact match)
  status      : includes, excludes
  content     : contains, notContains
  startDate   : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  endDate     : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  due         : isSet, isNotSet, equals, before, after, onOrBefore, onOrAfter
  color       : includes, excludes
  linestyle   : includes, excludes
  length      : lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual, equals, isSet, isNotSet
  taskType    : includes, excludes
  parent      : isSet, isNotSet
  children    : isSet, isNotSet
  property    : isSet, isNotSet, equals, contains, notContains

Value Types
-----------
  stringSet : { "type": "stringSet", "values": ["a", "b"] }
              Used by: file, tag, status, color, linestyle, taskType

  string    : { "type": "string", "value": "search text" }
              Used by: content

  boolean   : { "type": "boolean", "value": true }
              Used by: isSet / isNotSet operators

  date      : { "type": "date", "value": { "mode": "absolute", "date": "2026-03-15" } }
          or: { "type": "date", "value": { "mode": "relative", "preset": "<preset>" } }
              Used by: startDate, endDate, due

  number    : { "type": "number", "value": 60, "unit": "minutes" }
              Used by: length

  property  : { "type": "property", "key": "priority", "value": "high" }
              Used by: property

Date Presets
------------
  today, thisWeek, nextWeek, pastWeek, nextNDays (with "n" field), thisMonth, thisYear
`.trim();

export function createHelpHandler() {
    return (_params: CliData): string => {
        return HELP_TEXT;
    };
}
