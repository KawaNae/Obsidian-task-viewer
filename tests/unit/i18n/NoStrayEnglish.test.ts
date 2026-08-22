import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const SRC = resolve(__dirname, '../../../src');

function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return tsFiles(path);
        return name.endsWith('.ts') ? [path] : [];
    });
}

/** Source with comments blanked, so prose cannot be mistaken for code. */
function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * A string literal handed to one of the calls that put text on screen.
 * `\`` is included: a template literal's own text is just as visible as a
 * quoted one, and the audit that raised this missed every such site by
 * looking only for quotes.
 */
const LITERAL = String.raw`(['"\`])((?:\\.|(?!\1)[\s\S])*)\1`;

const SINKS: [string, RegExp][] = [
    ['Notice', new RegExp(String.raw`new Notice\(\s*` + LITERAL, 'g')],
    ['setTitle', new RegExp(String.raw`\.setTitle\(\s*` + LITERAL, 'g')],
    ['setName', new RegExp(String.raw`\.setName\(\s*` + LITERAL, 'g')],
    ['setDesc', new RegExp(String.raw`\.setDesc\(\s*` + LITERAL, 'g')],
    ['setPlaceholder', new RegExp(String.raw`\.setPlaceholder\(\s*` + LITERAL, 'g')],
    ['setButtonText', new RegExp(String.raw`\.setButtonText\(\s*` + LITERAL, 'g')],
    ['setTooltip', new RegExp(String.raw`\.setTooltip\(\s*` + LITERAL, 'g')],
    ['setText', new RegExp(String.raw`\.setText\(\s*` + LITERAL, 'g')],
    ['text', new RegExp(String.raw`\btext:\s*` + LITERAL, 'g')],
    ['placeholder', new RegExp(String.raw`\bplaceholder:\s*` + LITERAL, 'g')],
    ['aria-label', new RegExp(String.raw`aria-label['"]\s*,\s*` + LITERAL, 'g')],
];

/**
 * Whole directories whose "text" is not prose.
 *
 * `lang` and `flow` emit the notation itself (`x3`, `until(...)`) and carry
 * their diagnostics in English on purpose — English for flowDiag/flowEval
 * lives in the TS source, not en.json (reference_diagnostic_i18n).
 */
const EXEMPT_DIRS = ['services/lang/', 'services/flow/'];

interface Exemption {
    file: string;
    text: string;
    why: string;
}

/**
 * Individually argued exceptions. Every entry needs a reason, and an entry
 * that stops matching is itself a failure — a stale exemption is how a real
 * string sneaks back in under cover of an old excuse.
 */
const EXEMPTIONS: Exemption[] = [
    {
        file: 'main.ts',
        text: 'Task Viewer: ${msg}',
        why: 'The plugin name prefixing its own notices. A product name is not translated.',
    },
    {
        file: 'settings/index.ts',
        text: 'Task Viewer v${this.plugin.manifest.version}',
        why: 'Product name and version.',
    },
    {
        file: 'settings/index.ts',
        text: " — Built: ${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown'}",
        why: 'Build stamp shown next to the version. Read by whoever is filing a bug, in one form.',
    },
    {
        file: 'settings/AboutTab.ts',
        text: 'MIT',
        why: 'An SPDX licence identifier. It names a specific document and does not translate.',
    },
    // Placeholders that show the SHAPE of a value — a default, a moment
    // format, a path example. They are read as formats, and translating one
    // would tell the user to type something the parser rejects. Contrast the
    // interval creator's placeholders, which were prose ('Template name',
    // 'Search icons...') and are translated.
    {
        file: 'settings/BasicTab.ts',
        text: 'Templates/Views',
        why: 'Example path showing the expected shape of the setting.',
    },
    {
        file: 'settings/BasicTab.ts',
        text: 'task-viewer-export',
        why: 'The default folder name, shown as the value it would take.',
    },
    {
        file: 'settings/BasicTab.ts',
        text: 'Templates/Timers',
        why: 'Example path showing the expected shape of the setting.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'Tasks',
        why: 'The default heading name written into a note, so it is data rather than prose.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'gggg-[W]ww',
        why: 'A moment.js format string. Translating it would produce an invalid format.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'YYYY-MM',
        why: 'A moment.js format string. Translating it would produce an invalid format.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'YYYY',
        why: 'A moment.js format string. Translating it would produce an invalid format.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'Templates/Weekly.md',
        why: 'Example path showing the expected shape of the setting.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'Templates/Monthly.md',
        why: 'Example path showing the expected shape of the setting.',
    },
    {
        file: 'settings/NotesTab.ts',
        text: 'Templates/Yearly.md',
        why: 'Example path showing the expected shape of the setting.',
    },
    {
        file: 'modals/DateTimeInputModal.ts',
        text: 'YYYY-MM-DD',
        why: 'The date format the field accepts, shown literally so it can be copied.',
    },
    {
        file: 'modals/DateTimeInputModal.ts',
        text: 'HH:mm',
        why: 'The time format the field accepts, shown literally so it can be copied.',
    },
    {
        file: 'views/customMenus/IntervalTemplateCreator.ts',
        text: 'rotate-cw',
        why: 'An Obsidian icon id, shown as an example of what to type. Ids are not localized.',
    },
];

interface Hit {
    file: string;
    sink: string;
    text: string;
}

/** Text the literal contributes itself, with `${...}` holes removed. */
function ownText(literal: string): string {
    return literal.replace(/\$\{[^}]*\}/g, '');
}

function scan(): Hit[] {
    const hits: Hit[] = [];
    for (const path of tsFiles(SRC)) {
        const file = relative(SRC, path).split(/[\\/]/).join('/');
        if (EXEMPT_DIRS.some(dir => file.startsWith(dir))) continue;
        const source = code(readFileSync(path, 'utf-8'));
        for (const [sink, pattern] of SINKS) {
            for (const match of source.matchAll(pattern)) {
                // Two letters running: enough to be a word, so a separator
                // (':'), a unit ('%'), or an interpolation-only literal does
                // not register.
                if (/[A-Za-z]{2,}/.test(ownText(match[2]))) {
                    hits.push({ file, sink, text: match[2] });
                }
            }
        }
    }
    return hits;
}

describe('user-facing text', () => {
    const hits = scan();

    it('always goes through t()', () => {
        const stray = hits
            .filter(h => !EXEMPTIONS.some(e => e.file === h.file && e.text === h.text))
            .map(h => `${h.file} [${h.sink}] ${JSON.stringify(h.text)}`);
        expect(stray).toEqual([]);
    });

    it('has no exemption left over from a string that is gone', () => {
        const stale = EXEMPTIONS
            .filter(e => !hits.some(h => h.file === e.file && h.text === e.text))
            .map(e => `${e.file} ${JSON.stringify(e.text)}`);
        expect(stale).toEqual([]);
    });

    it('states a reason for every exemption', () => {
        expect(EXEMPTIONS.filter(e => e.why.trim().length < 20).map(e => e.file)).toEqual([]);
    });
});

/**
 * The scan itself, checked on text we control.
 *
 * The audit that raised this finding grepped raw source and counted prose as
 * code; it also looked only for quoted strings and so missed every template
 * literal — which is where seven of the strays this commit fixes were
 * hiding. Both mistakes are cheap to make again, so both are pinned here
 * rather than left to whether some comment in src happens to trip the guard.
 */
describe('the scan', () => {
    const hits = (text: string) => {
        const source = code(text);
        return SINKS.flatMap(([, pattern]) =>
            [...source.matchAll(pattern)].map(m => m[2]).filter(lit => /[A-Za-z]{2,}/.test(ownText(lit))));
    };

    it('reads code', () => {
        expect(hits(`new Notice('Task not found');`)).toEqual(['Task not found']);
    });

    it('does not read a line comment', () => {
        expect(hits(`// once this was new Notice('Task not found')`)).toEqual([]);
    });

    it('does not read a block comment', () => {
        expect(hits(`/* see new Notice('Task not found') above */`)).toEqual([]);
    });

    it('reads a template literal, not just a quoted string', () => {
        expect(hits('new Notice(`Saved to ${path}`);')).toEqual(['Saved to ${path}']);
    });

    it('ignores a literal that only carries interpolations and punctuation', () => {
        expect(hits('el.setText(`${done}/${total}`);')).toEqual([]);
        expect(hits('item.setTitle(`${key}: ${value}`);')).toEqual([]);
    });

    it('ignores a translated call', () => {
        expect(hits(`new Notice(t('notice.taskNotFoundInIndex'));`)).toEqual([]);
    });
});
