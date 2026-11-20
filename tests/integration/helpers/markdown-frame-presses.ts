/**
 * Clicks of the checkboxes of a markdown frame's card, in the running E2E
 * vault, and what each click wrote to the card's note, read off the note's
 * file. `markdown-frame-writes.test.ts` and
 * `markdown-frame-checkboxes.test.ts` share it.
 *
 * A click is answered once the note's file changed and the card was drawn
 * anew from it, or once a notice came.
 */
import { framesOf, notesUnder } from './markdown-frames';
import { SETTLE_MS, ev, tr } from './view-helper';

/** What a snippet run in the view `name` has: the view's frames, the notes under `prefix`, and the checkboxes of a card. */
export function cardsIn(prefix: string, name: string): string {
    return `
        ${framesOf(prefix, name)}
        const PLUGIN_DRAWN = '[class^="block-language-"], [class*=" block-language-"], .dataview';
        // The card of the frame \`id\` that \`which\` names: its place, or the text of the heading that opens it.
        const cardBody = (id, which) => {
            if (typeof which === 'number') return bodyOf(id, which);
            return cardsOf(id).map(c => c.querySelector('.markdown-frame__content'))
                .find(b => b?.querySelector('h1, h2, h3, h4, h5, h6')?.textContent === which) ?? null;
        };
        const rendered = async (id, which) => {
            for (let i = 0; i < 50 && !(cardBody(id, which)?.childElementCount > 0); i++) await wait(100);
            const body = cardBody(id, which);
            if (!body) throw new Error('no card ' + which + ' in ' + id);
            return body;
        };
        // The checkboxes the card's markdown drew: not an embed's, not another plugin's.
        const boxesOf = (body) => [...body.querySelectorAll('input.task-list-item-checkbox')]
            .filter(b => !b.closest('.internal-embed') && !b.closest(PLUGIN_DRAWN));
        const disk = (path) => app.vault.adapter.read(own(path));
        const noticesNow = () => new Set(document.querySelectorAll('.notice'));
        const noticesSince = (seen) => [...document.querySelectorAll('.notice')].filter(n => !seen.has(n)).map(n => n.textContent);
        // Wait for a click's answer: the note changed and the card drawn anew from it, or a notice.
        const answered = async (id, which, path, before, body, seen) => {
            for (let i = 0; i < 50 && (await disk(path)) === before && noticesSince(seen).length === 0; i++) await wait(100);
            if ((await disk(path)) !== before) {
                for (let i = 0; i < 50 && (cardBody(id, which) === body || !(cardBody(id, which)?.childElementCount > 0)); i++) await wait(100);
            }
        };
    `;
}

/** A click of `pressEach`, and what it answered. */
export interface Pressed {
    /** The note's file before the click. */
    before: string;
    /** The note's file once the click was answered. */
    note: string;
    /** The texts of the notices the click brought. */
    notices: string[];
    /** The first line of the item the checkbox clicked stands in, the items in it left out. */
    item: string;
    /** That of the card's checkbox after it, or nothing for the last. */
    next: string;
    /** The `data-task` of that item before the click: the status it is drawn with. */
    shown: string | null;
    /** Whether the checkbox clicked is checked right after the click. */
    checked: boolean;
}

/** Click, one after the other, the checkboxes `boxes` (their places among the card's) of the card `which` of the frame `id`, each once the one before was answered. */
export function pressEach(prefix: string, name: string, id: string, which: number | string, path: string, boxes: number[]): Pressed[] {
    return ev<Pressed[]>(`(async () => {
        ${cardsIn(prefix, name)}
        const out = [];
        for (const i of ${JSON.stringify(boxes)}) {
            const body = await rendered(${JSON.stringify(id)}, ${JSON.stringify(which)});
            const box = boxesOf(body)[i];
            if (!box) throw new Error('no checkbox ' + i + ' in the card');
            const before = await disk(${JSON.stringify(path)});
            const seen = noticesNow();
            // The first line of the item's own text, without the items and quotes nested in it.
            const itemOf = (b) => {
                const own = b.closest('li')?.cloneNode(true);
                own?.querySelectorAll('ul, ol, blockquote').forEach(n => n.remove());
                return (own?.textContent ?? b.parentElement?.textContent ?? '').trim().split('\\n')[0].trim();
            };
            const li = box.closest('li');
            const item = itemOf(box);
            const after = boxesOf(body)[i + 1];
            const next = after ? itemOf(after) : '';
            const shown = li?.getAttribute('data-task') ?? null;
            box.click();
            const checked = box.checked;
            await answered(${JSON.stringify(id)}, ${JSON.stringify(which)}, ${JSON.stringify(path)}, before, body, seen);
            out.push({ before, note: await disk(${JSON.stringify(path)}), notices: noticesSince(seen), item, next, shown, checked });
        }
        return JSON.stringify(out);
    })()`);
}

/** The number of checkboxes the card `which` of the frame `id` draws. */
export function boxCount(prefix: string, name: string, id: string, which: number | string): number {
    return ev<number>(`(async () => {
        ${cardsIn(prefix, name)}
        return JSON.stringify(boxesOf(await rendered(${JSON.stringify(id)}, ${JSON.stringify(which)})).length);
    })()`);
}

/** Write the notes under `prefix`, through the vault, and wait for the frames to read them. */
export function writeNotes(prefix: string, notes: Record<string, string>): void {
    ev(`(async () => {
        ${notesUnder(prefix)}
        for (const [path, content] of Object.entries(${JSON.stringify(notes)})) await writeNote(path, content);
        await new Promise(r => setTimeout(r, ${SETTLE_MS}));
        return JSON.stringify(true);
    })()`);
}

/** `text` with the status character of its line `line` turned, as a click turns it: a space to `x`, anything else to a space. */
export function turned(text: string, line: number): string {
    const lines = text.split('\n');
    lines[line] = lines[line].replace(/\[(.)\]/, (_m, status: string) => `[${status === ' ' ? 'x' : ' '}]`);
    return lines.join('\n');
}

/** `markdown` with each `@` a word of its own, `w<n>`, counted from `from`; and the count past the last. */
export function worded(markdown: string, from = 0): [string, number] {
    let n = from;
    return [markdown.replace(/@/g, () => `w${n++}`), n];
}

/** The words (`w<n>`) of `text`, whole. */
const wordsOf = (text: string): string[] => text.match(/(?<![\w])w\d+(?![\w])/g) ?? [];

/**
 * What a click of `pressEach` wrote, judged by the word drawn on the item
 * pressed, in a note each of whose words (`worded`) stands once:
 *
 * - `written`: the line that holds the item's word, and no other, has its
 *   status character turned as the checkbox is drawn (one drawn blank to
 *   `x`, any other to a space), and no notice came. An item with no word is
 *   held to a line with no word, the first word on the lines below it that
 *   of the card's next checkbox, when there is one
 * - `nothing`: the note is as it was, and the notice that nothing was
 *   written came, alone
 * - anything else, said as what went wrong
 */
export function judged(press: Pressed): string {
    const unmatched = tr('sidebar.checkboxUnmatched');
    if (press.note === press.before) {
        return press.notices.length === 1 && press.notices[0] === unmatched ? 'nothing' : `nothing written, with the notices ${JSON.stringify(press.notices)}`;
    }
    if (press.notices.length > 0) return `written, with the notices ${JSON.stringify(press.notices)}`;
    const before = press.before.split('\n');
    const after = press.note.split('\n');
    if (before.length !== after.length) return `the note's lines went from ${before.length} to ${after.length}`;
    const changed = before.flatMap((l, i) => (l === after[i] ? [] : [i]));
    if (changed.length !== 1) return `the lines ${JSON.stringify(changed)} changed`;
    const [at] = changed;
    const [was, now] = [before[at], after[at]];
    // By code points: a status may be one past the basic plane.
    const [wasChars, nowChars] = [Array.from(was), Array.from(now)];
    const diff = wasChars.flatMap((c, i) => (c === nowChars[i] ? [] : [i]));
    const status = press.shown === '' ? 'x' : ' ';
    if (wasChars.length !== nowChars.length || diff.length !== 1 || nowChars[diff[0]] !== status) return `the line ${at} went from ${JSON.stringify(was)} to ${JSON.stringify(now)}`;
    const words = wordsOf(press.item);
    const next = wordsOf(press.next)[0];
    const below = before.slice(at + 1).map(wordsOf).find(w => w.length > 0)?.[0];
    const held = words.length > 0 ? wordsOf(was).includes(words[0]) : wordsOf(was).length === 0 && (next === undefined || below === next);
    return held ? 'written' : `the line ${at} (${JSON.stringify(was)}) written for the item ${JSON.stringify(press.item)}`;
}
