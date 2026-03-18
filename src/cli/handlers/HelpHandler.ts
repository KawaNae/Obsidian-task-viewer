import type { CliData } from 'obsidian';

const HELP_TEXT = `
Task Viewer CLI Reference
=========================

Commands
--------
  list          List tasks with filters, sort, and pagination
  today         List tasks active today (visual-date aware)
  get           Get a single task by ID
  query         Query tasks using a saved view template
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
  filter=<json>        Full FilterState JSON (overrides all above — see below)

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

FilterState JSON
================

The "filter" flag accepts a FilterState JSON that overrides all simple filter flags.
Use it for advanced filtering: OR conditions, exact tag matching, nested groups, etc.

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

Examples
--------
1) Exact tag match ("work" only, excludes "work/meeting"):

  obsidian obsidian-task-viewer:list filter='{"root":{"type":"group","id":"g1","logic":"and","children":[{"type":"condition","id":"c1","property":"tag","operator":"equals","value":{"type":"stringSet","values":["work"]}}]}}'

2) OR condition (status is "x" OR due is on or before today):

  obsidian obsidian-task-viewer:list filter='{"root":{"type":"group","id":"g1","logic":"or","children":[{"type":"condition","id":"c1","property":"status","operator":"includes","value":{"type":"stringSet","values":["x"]}},{"type":"condition","id":"c2","property":"due","operator":"onOrBefore","value":{"type":"date","value":{"mode":"relative","preset":"today"}}}]}}'

3) Overdue tasks (due before today):

  obsidian obsidian-task-viewer:list filter='{"root":{"type":"group","id":"g1","logic":"and","children":[{"type":"condition","id":"c1","property":"due","operator":"before","value":{"type":"date","value":{"mode":"relative","preset":"today"}}}]}}'
`.trim();

export function createHelpHandler() {
    return (_params: CliData): string => {
        return HELP_TEXT;
    };
}
