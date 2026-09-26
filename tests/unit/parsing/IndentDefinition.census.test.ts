import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every reading of a line's indentation goes through `Outline`
 * (`INDENT_SOURCE`, `indentOf`, `dedent`), and every reading of a line's
 * content through `IN_LINE` (L1). A copy of its own is a second answer: `\s`
 * took a full-width space, a no-break space and U+2028 for indentation, and
 * the index and the writes read one note two ways.
 *
 * This walks the source for the idioms those copies were written in. The
 * fence readings that dedented a line before looking for a fence are gone:
 * they read the outline now (stage L2, `BlockReading.census.test.ts`).
 */

const SRC = join(__dirname, '../../../src');

const IDIOMS: Array<{ name: string; test: (line: string) => boolean }> = [
    { name: 'trimStart()', test: line => line.includes('.trimStart()') },
    { name: '^\\s* in a pattern', test: line => /\^\(?\\{1,2}s\*/.test(line) },
    { name: 'search(/\\S', test: line => line.includes('search(/\\S') },
    { name: '[^\\S', test: line => line.includes('[^\\S') },
];

/** Where an idiom may stay, and why. */
const ALLOWED: Record<string, string> = {};

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return path.endsWith('.ts') ? [path] : [];
    });
}

describe('one definition of indentation', () => {
    it('leaves no reading of a line\'s indentation of its own', () => {
        const found: string[] = [];
        for (const path of sources(SRC)) {
            const file = relative(SRC, path).split('\\').join('/');
            if (file in ALLOWED) continue;
            readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
                if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
                for (const idiom of IDIOMS) {
                    if (idiom.test(line)) found.push(`${file}:${i + 1} ${idiom.name}`);
                }
            });
        }
        expect(found).toEqual([]);
    });
});

describe('one relation between lines', () => {
    /**
     * Two lines are compared as `Outline.VERBATIM` and no other relation. A
     * comparison or a lookup made of dedented lines by hand is a second
     * relation, which the outline does not answer for.
     */
    it('leaves no comparison of dedented lines outside Outline', () => {
        const byHand = /dedent\(.*([!=]==|\.has\(|\.get\()|([!=]==|\.has\(|\.get\().*dedent\(/;
        const found: string[] = [];
        for (const path of sources(SRC)) {
            const file = relative(SRC, path).split('\\').join('/');
            if (file === 'services/parsing/utils/Outline.ts') continue;
            readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
                if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
                if (byHand.test(line)) found.push(`${file}:${i + 1}`);
            });
        }
        expect(found).toEqual([]);
    });
});
