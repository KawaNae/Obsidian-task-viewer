import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Where a list item or a subtree ends, what a task's parent and children
 * are, and whether a line is code are answered by one reading of the note,
 * `Outline.read` (stage L2). A reading of its own — a delimiter matched by a
 * pattern, a line dedented to look for a fence, a walk that compares depths
 * to find where a subtree ends — is a second answer, and the parser, the
 * writes and the editor read one note two ways (BK1, R5, the F4 exceptions).
 *
 * This walks the source for the idioms those readings were written in.
 */

const SRC = join(__dirname, '../../../src');

/** The two files the reading lives in. */
const READING = new Set(['services/parsing/utils/Outline.ts', 'utils/CodeFenceTracker.ts']);

const IDIOMS: Array<{ name: string; test: (line: string) => boolean }> = [
    // A fence delimiter written into a pattern or a string: ``` or ~~~, or a
    // run of three counted by a quantifier.
    { name: 'a fence delimiter', test: line => /`{3}|~{3}|`\{3|~\{3/.test(line) },
    // Asking the delimiter reading directly: which column it measures from
    // is the outline's question.
    { name: 'CodeFenceTracker', test: line => /CodeFenceTracker[.(]|new CodeFenceTracker/.test(line) },
    // A line's depth, which a walk compares to find where a subtree ends.
    // Every depth read outside the outline is listed below with what it is
    // for; a new one is a walk until it says otherwise.
    { name: 'depthOf', test: line => /depthOf\(/.test(line) },
];

/** A line that may stay, by its file and a piece of its text, and why. */
const ALLOWED: Array<{ file: string; contains: string; reason: string }> = [
    {
        file: 'services/parsing/tree/DocumentTreeBuilder.ts',
        contains: 'Outline.depthOf(line) !== 0',
        reason: 'a section property is a line at column 0: a point check of one line, not a walk',
    },
    {
        file: 'services/parsing/tree/DocumentTreeBuilder.ts',
        contains: 'indent: Outline.depthOf(rawLine)',
        reason: 'TaskBlock.indent, the task\'s depth as a value (Task.indent); no walk reads it',
    },
    // A template file keeps its JSON in a fence it writes and reads whole;
    // that is the file's own format, not a reading of a note's blocks.
    { file: 'services/template/ViewTemplateLoader.ts', contains: '```json', reason: 'template JSON' },
    { file: 'services/template/ViewTemplateWriter.ts', contains: '```', reason: 'template JSON' },
    { file: 'timer/IntervalTemplateLoader.ts', contains: '```json', reason: 'template JSON' },
    { file: 'timer/IntervalTemplateWriter.ts', contains: '```', reason: 'template JSON' },
];

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

describe('one reading of a note\'s blocks', () => {
    it('leaves no reading of fences or subtrees of its own outside Outline', () => {
        const found: string[] = [];
        for (const path of sources(SRC)) {
            const file = relative(SRC, path).split('\\').join('/');
            if (READING.has(file)) continue;
            readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
                if (/^import\b/.test(trimmed)) return;
                if (ALLOWED.some(allowed => allowed.file === file && line.includes(allowed.contains))) return;
                for (const idiom of IDIOMS) {
                    if (idiom.test(line)) found.push(`${file}:${i + 1} ${idiom.name}`);
                }
            });
        }
        expect(found).toEqual([]);
    });

    it('allows only lines that are still there', () => {
        for (const allowed of ALLOWED) {
            const text = readFileSync(join(SRC, allowed.file), 'utf8');
            expect(text.includes(allowed.contains), `${allowed.file}: ${allowed.contains}`).toBe(true);
        }
    });
});
