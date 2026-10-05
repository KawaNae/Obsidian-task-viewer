import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { OPERATIONS, CLI_COMMANDS } from '../../../src/api/Reference';
import { toCliFlags, CLI_OUTPUT_SCHEMA, type ParamSpec } from '../../../src/api/OperationSchemas';
import { ALL_FIELD_NAMES } from '../../../src/api/TaskNormalizer';
import { PROPERTY_OPERATORS } from '../../../src/services/filter/FilterTypes';
import { SORT_PROPERTIES } from '../../../src/services/sort/SortTypes';

/**
 * The user docs are written by hand; their tables name what the code takes
 * and gives. These fix that the names agree with the tables the code runs
 * on: each method's parameters (`OperationSchemas`), each command's flags,
 * the fields of a task (`ALL_FIELD_NAMES`), the filter's properties and
 * operators (`PROPERTY_OPERATORS`) and the sort's properties. The words
 * around them are not checked.
 */

const root = join(__dirname, '../../..');
const apiDoc = readFileSync(join(root, 'docs/api.md'), 'utf8');
const cliDoc = readFileSync(join(root, 'docs/cli.md'), 'utf8');

/** The text from `start` to the next heading of `level` or above (or the end); code blocks are left out, their `#` lines being no headings. */
function sectionOf(markdown: string, start: string, level: number): string {
    const doc = markdown.replace(/^```[\s\S]*?^```$/gm, '');
    const at = doc.indexOf(start);
    if (at < 0) throw new Error(`not found: ${start}`);
    const rest = doc.slice(at + start.length);
    const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
    return next < 0 ? rest : rest.slice(0, next);
}

/** The rows of every table in `text` whose header starts with `header`, as their cells. */
function tableRows(text: string, header: RegExp): string[][] {
    const rows: string[][] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!header.test(lines[i])) continue;
        for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
            rows.push(lines[j].split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim()));
        }
    }
    return rows;
}

/** The first cell of each row, without its backticks. */
const keysOf = (rows: string[][]) => rows.map(r => r[0].replace(/`/g, ''));

/** The rows of the table right after `marker` (a bold label or a heading). */
function tableAfter(doc: string, marker: string): string[][] {
    const at = doc.indexOf(marker);
    if (at < 0) throw new Error(`not found: ${marker}`);
    const lines = doc.slice(at + marker.length).split('\n');
    const first = lines.findIndex(l => l.startsWith('|'));
    const rows: string[][] = [];
    for (let j = first + 2; j < lines.length && lines[j].startsWith('|'); j++) {
        rows.push(lines[j].split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim()));
    }
    return rows;
}

describe('docs/api.md', () => {
    for (const [name, op] of Object.entries(OPERATIONS)) {
        if (!('api' in op) || !('schema' in op)) continue;
        const typeName = name.charAt(0).toUpperCase() + name.slice(1) + 'Params';
        it(`${typeName} lists the parameters ${name} takes`, () => {
            const schema: Record<string, ParamSpec> = op.schema;
            expect(keysOf(tableAfter(apiDoc, `**${typeName}:**`)).sort()).toEqual(Object.keys(schema).sort());
        });
    }

    it('lists the fields of NormalizedTask, in order', () => {
        expect(keysOf(tableAfter(apiDoc, '## NormalizedTask フィールド'))).toEqual([...ALL_FIELD_NAMES]);
    });

    it("lists the filter's properties with their operators", () => {
        const rows = tableAfter(apiDoc, '## FilterState');
        expect(keysOf(rows)).toEqual(Object.keys(PROPERTY_OPERATORS));
        for (const row of rows) {
            const property = row[0].replace(/`/g, '') as keyof typeof PROPERTY_OPERATORS;
            expect(row[1].replace(/`/g, '').split(', '), property).toEqual([...PROPERTY_OPERATORS[property]]);
        }
    });

    it("lists the sort's properties", () => {
        expect(keysOf(tableAfter(apiDoc, '**ApiSortRule:**'))).toEqual([...SORT_PROPERTIES]);
    });
});

describe('docs/cli.md', () => {
    for (const command of CLI_COMMANDS) {
        if (!command.schema) continue;
        it(`${command.name} lists the flags it takes`, () => {
            const section = sectionOf(cliDoc, `### ${command.name} — `, 3);
            const flags = keysOf(tableRows(section, /^\| フラグ/));
            expect(flags.sort()).toEqual(Object.keys(toCliFlags(command.schema!)).sort());
        });
    }

    it('lists the common flags', () => {
        expect(keysOf(tableAfter(cliDoc, '## 共通フラグ')).sort()).toEqual(Object.keys(toCliFlags(CLI_OUTPUT_SCHEMA)).sort());
    });

    it('lists the output fields, in order', () => {
        expect(keysOf(tableAfter(cliDoc, '## 出力フィールド'))).toEqual([...ALL_FIELD_NAMES]);
    });
});
