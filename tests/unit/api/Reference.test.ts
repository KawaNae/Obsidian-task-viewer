import { describe, it, expect } from 'vitest';
import { API_REFERENCE, CLI_REFERENCE, CLI_COMMANDS, OPERATIONS } from '../../../src/api/Reference';
import { ALL_FIELD_NAMES } from '../../../src/api/TaskNormalizer';
import { PROPERTY_OPERATORS, type FilterProperty } from '../../../src/services/filter/FilterTypes';
import { SORT_PROPERTIES } from '../../../src/services/sort/SortTypes';
import { registerCliHandlers } from '../../../src/cli/CliRegistrar';

/**
 * The references are made from the tables the plugin runs on (`api/Reference`).
 * These fix that each table reaches both texts: a property with its
 * operators, every field a task is handed out with, every sort property,
 * and every command with its own section of flags.
 */

const references = { api: API_REFERENCE, cli: CLI_REFERENCE };

describe('the references', () => {
    for (const [name, text] of Object.entries(references)) {
        it(`${name}: lists every filter property with exactly its operators`, () => {
            for (const property of Object.keys(PROPERTY_OPERATORS) as FilterProperty[]) {
                const line = new RegExp(`^ {2}${property} *: (.+)$`, 'm').exec(text);
                expect(line, property).not.toBeNull();
                expect(line![1].split(', ')).toEqual([...PROPERTY_OPERATORS[property]]);
            }
        });

        it(`${name}: lists every field of a task, effectiveDue and flow among them`, () => {
            expect(ALL_FIELD_NAMES).toContain('effectiveDue');
            expect(ALL_FIELD_NAMES).toContain('flow');
            const listed = new Set(text.match(/[A-Za-z]+/g));
            for (const field of ALL_FIELD_NAMES) expect(listed.has(field), field).toBe(true);
        });

        it(`${name}: lists every sort property`, () => {
            for (const property of SORT_PROPERTIES) {
                expect(text, property).toMatch(new RegExp(`^ {4}${property} +\\S`, 'm'));
            }
        });
    }

    it('api: has a method for every operation the API has', () => {
        for (const op of Object.values(OPERATIONS)) {
            if ('api' in op) expect(API_REFERENCE).toContain(`  ${op.api.signature}\n`);
        }
    });

    it('cli: has a section of flags for every command but help, today, get and delete among them', () => {
        const sections = CLI_COMMANDS.filter(c => c.name !== 'help').map(c => c.name);
        expect(sections).toEqual(expect.arrayContaining(['today', 'get', 'delete']));
        for (const name of sections) {
            expect(CLI_REFERENCE, name).toContain(`\n${name}\n${'-'.repeat(name.length)}\n`);
        }
    });

    it('cli: spells a multi-word parameter in its notes as the flag', () => {
        const duplicate = CLI_REFERENCE.slice(CLI_REFERENCE.indexOf('\nduplicate\n'));
        expect(duplicate).toMatch(/Without day-offset/);
    });
});

describe('CLI_COMMANDS', () => {
    it('is what the registrar registers, with the summaries the help lists', () => {
        const registered: { name: string; description: string }[] = [];
        registerCliHandlers({
            registerCliHandler: (name: string, description: string) => { registered.push({ name, description }); },
        } as never);

        expect(registered.map(r => r.name)).toEqual(CLI_COMMANDS.map(c => `obsidian-task-viewer:${c.name}`));
        for (const [i, command] of CLI_COMMANDS.entries()) {
            expect(registered[i].description.startsWith(command.summary)).toBe(true);
            expect(CLI_REFERENCE).toMatch(new RegExp(`^ {2}${command.name} +${command.summary.replace(/[()/]/g, '\\$&')}$`, 'm'));
        }
    });
});
