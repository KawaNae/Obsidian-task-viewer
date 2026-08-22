import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import en from '../../../src/i18n/locales/en.json';
import ja from '../../../src/i18n/locales/ja.json';

/**
 * Keys nothing asks for.
 *
 * The opposite direction from NoStrayEnglish: that one finds text on screen
 * that never reached a locale file, this one finds locale entries that never
 * reach the screen. Both failures are silent, and this one especially so —
 * `FilterValueHelpers` asks with `t(key) !== key ? t(key) : v`, so a deleted
 * key does not throw, it quietly falls back to the raw value and a Japanese
 * vault starts reading "inline" where it read「インライン」.
 *
 * A key is unused when no source file names it and no runtime-built key can
 * reach it. The second half is the hard one: `t(\`filter.property.${p}\`)`
 * covers sixteen keys that appear nowhere as literals. So the prefixes that
 * runtime construction covers are derived from the source rather than
 * written down — a hand-maintained list goes stale, and a stale exclusion
 * list is how this guard would stop working without anyone noticing.
 *
 * Derivation rule: a template literal counts when it reaches `t()`, either
 * directly or through a local it is assigned to in the same file. Reaching
 * `t()` is the whole test — it is what separates an i18n key from a CSS
 * selector, a diagnostic code, or a settings path that happens to be written
 * the same way.
 *
 * A narrower rule was tried and rejected: taking every dotted template and
 * keeping those whose first segment is a real namespace. It excludes CSS
 * selectors well enough today, but one `\`settings.${field}\`` written for a
 * settings path — never handed to `t()` — would silently drop all 219
 * `settings.*` keys out of this check (measured). The two rules fail in
 * opposite directions, and this one fails the recoverable way: too narrow
 * shows a live key in the list below, where a person sees it.
 */

const SRC = resolve(__dirname, '../../../src');

function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return tsFiles(path);
        return name.endsWith('.ts') ? [path] : [];
    });
}

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
    return Object.entries(tree).flatMap(([k, v]) => {
        const path = prefix ? `${prefix}.${k}` : k;
        return typeof v === 'string' ? [path] : flatten(v, path);
    });
}

const SOURCES = tsFiles(SRC).map(p => readFileSync(p, 'utf-8'));
const ALL_SOURCE = SOURCES.join('\n');

const EN_KEYS = flatten(en as Tree);
/**
 * Both locales, for the prefix assertion only. `flowDiag` / `flowEval` exist
 * in ja alone by design — their English is the `message` field in the TS
 * source (see JA_ONLY_NAMESPACES in LocaleParity.test.ts) — so a prefix
 * checked against en alone would look like it governs nothing.
 */
const ALL_KEYS = new Set([...EN_KEYS, ...flatten(ja as Tree)]);

/** `t(`pfx.${…}`)` — the template handed straight to the call. */
const DIRECT = /(?<![A-Za-z0-9_$.])t\(\s*`([^`$]*)\$\{/g;
/** `const key = `pfx.${…}`` — parked in a local first. */
const VIA_LOCAL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*`([^`$]*)\$\{/g;

function runtimePrefixes(): string[] {
    const found = new Set<string>();
    for (const text of SOURCES) {
        for (const m of text.matchAll(DIRECT)) {
            if (m[1].includes('.')) found.add(m[1]);
        }
        for (const m of text.matchAll(VIA_LOCAL)) {
            const [, name, prefix] = m;
            if (!prefix.includes('.')) continue;
            const handedToT = new RegExp(String.raw`(?<![A-Za-z0-9_$.])t\(\s*${name}\s*[),]`);
            if (handedToT.test(text)) found.add(prefix);
        }
    }
    return [...found].sort();
}

const PREFIXES = runtimePrefixes();

function isNamedInSource(key: string): boolean {
    return ALL_SOURCE.includes(`'${key}'`)
        || ALL_SOURCE.includes(`"${key}"`)
        || ALL_SOURCE.includes(`\`${key}\``);
}

describe('the prefixes runtime construction covers', () => {
    it('are derived from the source, not written down here', () => {
        // A sanity floor: the filter menu alone builds several. Zero would
        // mean the derivation stopped matching and every runtime-built key
        // is about to be reported as unused.
        expect(PREFIXES.length).toBeGreaterThan(5);
    });

    it('each govern at least one real key', () => {
        // A prefix that governs nothing came from a template that is not an
        // i18n key — a CSS selector, a diagnostic code, a path. It would
        // exclude nothing today and anything tomorrow, so it is a signal
        // that the derivation has started reading the wrong thing.
        const govern = (p: string) => [...ALL_KEYS].some(k => k.startsWith(p));
        expect(PREFIXES.filter(p => !govern(p))).toEqual([]);
    });
});

describe('every key in en.json is asked for', () => {
    it('by name, or by a prefix that runtime construction builds', () => {
        const unused = EN_KEYS.filter(
            k => !isNamedInSource(k) && !PREFIXES.some(p => k.startsWith(p)),
        );
        expect(unused).toEqual([]);
    });
});
