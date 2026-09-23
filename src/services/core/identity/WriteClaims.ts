import type { ParserId, Task } from '../../../types';
import { UNKNOWN_READING, type ExactState, type Reading } from './IdentityHints';
import type { LedgerEntry } from './IdentityLedger';
import { ledgerRowsOf } from './IdentityMatcher';
import { replayEdits, type LineEdit, type WriteOrigin } from '../../../utils/FileLines';
import { contentKeyOf, type ContentKey } from './ContentKey';

/**
 * A row of a file as a write left it: which line, what it reads, and whose
 * identity it carries.
 *
 * Every row has a name. A line a write created is named on the spot, by the
 * write, and `created` is what says so: the ledger has not heard that name
 * yet, so a scan must not refuse the row for being absent from it, and must
 * not mint a second name for the same line when it commits.
 */
export interface ClaimBase {
    runtimeId: string;
    created: boolean;
    text: string;
    line: number;
    /** The parser that read the row, when the one who recorded it knew. */
    parserId?: ParserId;
}

/**
 * What the last scan of a file recorded: the rows it read, and the key of the
 * content it read them from — null when no scan has committed the file.
 */
export interface LedgerState {
    rows: ClaimBase[];
    content: ContentKey | null;
}

/** What a write left on record, and a handle that takes the whole call back. */
export interface ClaimResult {
    /** Whether the write could say what the file now is: a record, rather than a mark. */
    described: boolean;
    /**
     * Undo everything this call left behind.
     *
     * A claim is filed from inside `vault.process`, before the write is known
     * to have landed (see `processLines`), and what it leaves behind is both
     * a state the next scan weighs the read against and the base the *next*
     * write to this file would build on. A write that threw, or whose
     * callback Obsidian ran again, must leave neither.
     */
    withdraw: () => void;
    /**
     * The rows this write named on the spot, where they stand in the lines it
     * wrote. Empty when it claimed nothing: a name is worth handing out only
     * if the scan that adopts the claim gives the row that same name.
     */
    made: Array<{ line: number; runtimeId: string }>;
}

/**
 * How many writes one file's chain may hold (see {@link Chain}).
 *
 * Far past anything a file sees between two scans: every write is followed by
 * the scan its own `modify` starts, and only a file whose scans are held off
 * (a drag) gathers more than one or two. What this exists for is a file no
 * scan reaches again, which must not grow without bound. Outside changes in a
 * row are one link, so they cannot fill it. Since I1 every record keeps its
 * rows (the text and the name of each, the strings shared with the parse that
 * made them), so a file's chain costs in proportion to its rows times its
 * records: nothing between two scans in use, and the cap bounds a drag that
 * never ends.
 */
export const MAX_CHAIN_PER_FILE = 1024;

/**
 * One write of ours to a file that the ledger has not read, as it landed.
 *
 * Either described — a record: the key of the content the write left and
 * the rows in it, and, for the newest record only, the same rows as a ladder
 * reads its previous side (`ladder`) — or a mark: a write landed that this
 * class could not describe, so nothing it holds is true of the file any more,
 * and nothing older is either.
 *
 * A record is also what used to be filed apart as the write's claim (a
 * `Hint`): one write leaves one link, and a scan weighs the read against the
 * records themselves (see {@link WriteClaims.reading}).
 *
 * `filed` numbers the writes in the order they landed (see
 * {@link WriteClaims.readMark}).
 *
 * A described link also says whom the write was made for, and which rows it
 * wrote — made, or gave a new text — with the text it gave each. That is what
 * lets a scan answer, row by row, whether a completion it reads is one a write
 * of ours made and for whom (see {@link WriteClaims.writerOf}). Unlike the
 * rows, every described link keeps it: a read can be of any state in the
 * chain, and what an older write wrote is what such a read holds. A mark keeps
 * it too when the write knew it: the rows it asked for by name, and the line
 * it left each on, are the write's own knowledge, not the claim's.
 */
type Link =
    | {
        filed: number;
        content: ContentKey;
        /** The rows, as the next write builds on them, `locate` reads them, and a scan weighs them. */
        rows: ClaimBase[];
        /** The same rows as a ladder reads its previous side; the newest record only. */
        ladder: LedgerEntry[] | null;
        origin: WriteOrigin;
        wrote: ReadonlyMap<string, string>;
        foreign?: undefined;
    }
    | { filed: number; content: null; origin?: WriteOrigin; wrote?: ReadonlyMap<string, string>; foreign?: undefined }
    | Foreign;

/**
 * A change to the file that no write of ours accounts for: a `modify` or a
 * `create` that came when no write of ours was waiting for one (see
 * {@link WriteClaims.noteChange}). Not a write, so it names nothing and says
 * nothing of the content; what it says is that the file moved after whatever
 * stands before it in the chain. Two in a row say no more than one, so they
 * are one link, filed as the later.
 */
interface Foreign {
    filed: number;
    content: null;
    foreign: true;
    origin?: undefined;
    wrote?: undefined;
}

const isForeign = (link: Link): link is Foreign => link.foreign === true;

/** The chain's links that are writes of ours. */
const ownLinks = (links: readonly Link[]): Link[] => links.filter(link => !isForeign(link));

/** A link that says what its write left. */
type Described = Extract<Link, { content: ContentKey }>;

/**
 * Where a read stands among the states a file is known to have been in (see
 * {@link WriteClaims.reading}): what the match is made from (`reading`), and
 * what a committing scan hands back to say what it read (see
 * {@link WriteClaims.forget}).
 */
export interface ReadPlace {
    reading: Reading;
    /**
     * Nothing about the read can be told: the cap dropped states it may be,
     * or, asked by a write, our newest write could not say what it left.
     */
    unknown: boolean;
    /** The known states with the read's content, as links of the chain (or the ledger). */
    states: ReadonlyArray<object | 'ledger'>;
    /** Whether the read may be a change after the newest known state. */
    after: boolean;
    /**
     * The rows the lines hold where they stand, when that can be read off
     * the lines without parsing them: the read is one known state and
     * nothing after it, and each of the state's rows reads its own text on
     * its own line. Asked by a write only; null otherwise.
     */
    base: ClaimBase[] | null;
}

/** Who asks where a read stands (see {@link WriteClaims.reading}). */
export type Reader = 'scan' | 'write';

/**
 * Every write of ours to one file that the ledger has not read, in the order
 * they landed.
 *
 * Not only the last: the question a scan will put to this chain — is what I
 * read some state our own writes left, or a change that came after the last
 * of them — takes every state, because a read can land between two writes.
 * Every record keeps its rows, for a read of its state to be told by them;
 * only the newest keeps them in the ladder's shape as well.
 */
interface Chain {
    links: Link[];
    /**
     * A scan committed without having read these writes: it read the file
     * before they landed, and committed after. Its ledger is older than them,
     * and a write builds on neither (see {@link WriteClaims.reading}).
     */
    carried: boolean;
    /**
     * The newest `filed` among the links the cap dropped, or 0. While a scan
     * that read after it has not committed, the chain cannot say it knows
     * every state the file was in.
     */
    lost: number;
}

/**
 * Turns a write's report of what it did to the lines into a claim about what
 * the file's task rows now are.
 *
 * The division of labour here is the point of stage 2. A writer knows which
 * lines it touched and cannot know which of them are tasks: whether a line is
 * a task depends on the fence it might sit inside, on a `tv-gen` block, on
 * `tv-ignore`, on which third-party notations are switched on — questions only
 * the parser answers. So the writer reports lines, this answers rows, and the
 * parser is what turns one into the other. An earlier plan had each writer
 * claim its own rows; it would have put a copy of the parser's judgement in
 * every write site, and the duplicate — which copies whole blocks of child
 * lines, fences and all — is exactly where such a copy is wrong.
 *
 * Nothing here decides identity on evidence. Every row either carries an
 * identity the write itself preserved or is declared new, and the scan checks
 * the whole claim against what it reads before believing any of it.
 */
export class WriteClaims {
    /**
     * Per file, the writes of ours the ledger has not read.
     *
     * The newest described one is what lets a second write claim anything when
     * no scan has run in between — the ledger still holds the state before the
     * first write, and the second write's file does not match it. That use
     * lasts only until the next scan of the file commits: after that the
     * ledger is the authority, and a state kept across a scan that answered
     * some other way (the ladder, when a claim went unadopted) would carry
     * identities the ledger does not agree with. The texts would still line
     * up, so nothing downstream would catch it. What a committing scan did not
     * read is kept all the same, marked `carried`, to say the ledger is older
     * than it (see {@link forget}).
     */
    private readonly chains = new Map<string, Chain>();

    /** How many links have filed here: writes, described or not, and outside changes. */
    private filed = 0;

    /**
     * Per file, the writes of ours that have filed and whose `modify` has not
     * come, oldest first, by `filed`.
     *
     * Kept apart from the chain because it outlives it: a scan can read a
     * write's bytes and commit before that write's `modify` is delivered, and
     * the `modify` that follows is still ours. Only a file's removal (a
     * delete, a rename) drops it, and taking a write back drops its entry.
     */
    private readonly awaiting = new Map<string, number[]>();

    /**
     * @param parseRows the file's tasks, in the order a scan matches them,
     *   from the same pipeline a scan uses. Null when the parser refuses to
     *   read the file as tasks at all (`tv-ignore`), which is not the same
     *   answer as a file with no rows in it.
     * @param ledgerState what the last scan of this file recorded.
     * @param mintRuntimeId a name for a row this write made. Issued here, at
     *   the moment the line comes into being, rather than by the scan that
     *   reads it: two scans can read the same created line — one committing a
     *   claim while a second write is already filed on top of it — and a name
     *   issued by the reader would be a different name each time.
     */
    constructor(
        private readonly parseRows: (path: string, lines: readonly string[]) => Task[] | null,
        private readonly ledgerState: (path: string) => LedgerState,
        private readonly mintRuntimeId: (path: string, parserId: ParserId) => string,
    ) { }

    /**
     * What this write claims the file's rows now are — a null `hint` when it
     * cannot say, in which case the next scan falls to the ladder, as it did
     * before stage 2.
     *
     * `edits` is null for a write that changed the file and could not say how
     * (see `WriteSink`): it claims nothing and leaves the mark.
     */
    claim(
        path: string,
        before: readonly string[],
        after: readonly string[],
        edits: readonly LineEdit[] | null,
        origin: WriteOrigin,
        named: ReadonlyMap<string, string> | null = null,
    ): ClaimResult {
        // Every way out of here without a claim is the same situation: this
        // write changed the file — `processLines` calls a sink for nothing
        // else — and nothing here can say what the file now is. Leaving no
        // link would say the opposite, that the state before it may be built
        // on again, and that state is older now. So the file is marked
        // instead, and stays marked until a scan of it commits.
        const nothing = (): ClaimResult => ({ described: false, withdraw: this.silence(path, origin, named), made: [] });

        if (edits === null) return nothing();

        // What the rows of the lines this write was handed are, where they
        // stand. A write builds only on that; the ladder's partner does not
        // come into it.
        const base = this.reading(path, before, 'write', []).base;
        if (base === null) return nothing();

        const replayed = replayEdits(before.length, edits);
        if (!replayed || replayed.origin.length !== after.length) return nothing();

        // A file the parser will not read as tasks has no rows to claim, and
        // saying it has none would be a claim of its own.
        const parsed = this.parseRows(path, after);
        if (parsed === null) return nothing();

        // Which identity each line of the file now carries: the one its line
        // carried before the write, unless the write made the line.
        const identityOf = new Map<number, ClaimBase>();
        for (const row of base) identityOf.set(row.line, row);

        const rows: ClaimBase[] = [];
        const made: ClaimResult['made'] = [];
        const wrote = new Map<string, string>();
        const nameOf = new Map<Task, string>();
        const crossed = new Set<string>();
        for (const task of parsed) {
            const from = replayed.origin[task.line];
            // `created` travels with the identity, not with this write: a row
            // the *previous* write made is still one the ledger has never
            // heard of, and the scan that finally reads it has to be told so
            // however many writes it has sat through since.
            const carried = from === null ? undefined : identityOf.get(from);
            if (carried) {
                rows.push({ runtimeId: carried.runtimeId, created: carried.created, text: task.originalText, line: task.line, parserId: task.parserId });
                nameOf.set(task, carried.runtimeId);
                if (carried.text !== task.originalText) wrote.set(carried.runtimeId, task.originalText);
                if (carried.parserId !== undefined && carried.parserId !== task.parserId) crossed.add(carried.runtimeId);
                continue;
            }
            // Either the write made this line, or it made a task of a line
            // that was not one — a row with no past either way.
            const runtimeId = this.mintRuntimeId(path, task.parserId);
            rows.push({ runtimeId, created: true, text: task.originalText, line: task.line, parserId: task.parserId });
            nameOf.set(task, runtimeId);
            wrote.set(runtimeId, task.originalText);
            made.push({ line: task.line, runtimeId });
        }

        const content = contentKeyOf(after);
        // The same rows, read the way a scan would have recorded them, for a
        // ladder that has to pair against this state. Less a row whose name
        // the write carried from one parser's reading to another's: a scan
        // never hands a name across parsers, and neither may a ladder paired
        // against this state (the claim itself is refused for it, see
        // `reproduces`).
        const ladder = ledgerRowsOf(parsed, task => nameOf.get(task)!)
            .filter(entry => !crossed.has(entry.runtimeId));
        const withdraw = this.append(path, { filed: ++this.filed, content, rows, ladder, origin, wrote });
        return { described: true, withdraw, made };
    }

    /**
     * File a record whose rows are said outright rather than worked out from
     * a write's report — as a write that left `lines` would have filed it.
     * For tests of what a scan does with a record no real write could leave
     * (one name on two rows, a name the ledger never held), and for a console.
     * The rows carry no coordinates, so no write builds on this record and
     * `locate` never reads a line off it; a ladder pairing against the file
     * pairs against the state before it.
     *
     * @internal
     */
    fileRecord(path: string, lines: readonly string[], rows: ReadonlyArray<{ runtimeId: string; created: boolean; text: string }>, origin: WriteOrigin = 'user'): () => void {
        return this.append(path, {
            filed: ++this.filed,
            content: contentKeyOf(lines),
            rows: rows.map(row => ({ ...row, line: -1 })),
            ladder: null,
            origin,
            wrote: new Map(),
        });
    }

    /**
     * Mark that a write of ours changed this file and nothing here can say
     * how — for when even {@link claim} could not run. The same mark a claim
     * that cannot say leaves, and taken back the same way.
     */
    silence(path: string, origin?: WriteOrigin, named?: ReadonlyMap<string, string> | null): () => void {
        return this.append(path, { filed: ++this.filed, content: null, origin, wrote: named ?? undefined });
    }

    /**
     * Add a write to the file's chain, and answer the handle that takes it
     * back.
     *
     * Taking it back removes this link and nothing else. The chain may have
     * grown since — two writes to one file can be in flight at once — and what
     * a later write left is still true: a later mark still says the file was
     * changed in a way nobody described, and putting back the state from
     * before this call would paper over it with a state older than the file.
     *
     * Two things follow. A described link a later described link was built on
     * stays: that one fitted the file only because this write's content was
     * there, so this write landed whatever its caller was told. And a link
     * that is removed gives the previous described link back the rows it
     * handed on to it.
     */
    private append(path: string, link: Link & { foreign?: undefined }): () => void {
        const chain = this.chainOf(path);

        // Only the newest record keeps its rows in the ladder's shape.
        let stripped: { link: Described; ladder: LedgerEntry[] } | null = null;
        if (link.content !== null) {
            const previous = newestDescribed(chain.links);
            if (previous?.ladder) {
                stripped = { link: previous, ladder: previous.ladder };
                previous.ladder = null;
            }
        }
        chain.links.push(link);
        this.cap(chain);
        // Every write that files here changed the file (`processLines` calls
        // a sink for nothing else), so a `modify` is on its way for it.
        const waiting = this.awaiting.get(path) ?? [];
        waiting.push(link.filed);
        this.awaiting.set(path, waiting);

        const unawait = (): void => {
            const current = this.awaiting.get(path);
            const at = current?.indexOf(link.filed) ?? -1;
            if (at < 0) return;
            current!.splice(at, 1);
            if (current!.length === 0) this.awaiting.delete(path);
        };

        return () => {
            const current = this.chains.get(path);
            const at = current === chain ? chain.links.indexOf(link) : -1;
            // Gone from the chain already — a scan committed past it — or the
            // chain with it: the write did not land, and no `modify` will come.
            if (at < 0) {
                unawait();
                return;
            }
            // A later write of ours built on this one: it landed.
            const next = chain.links.slice(at + 1).find(later => !isForeign(later));
            if (next && next.content !== null) return;
            chain.links.splice(at, 1);
            unawait();
            if (stripped && chain.links.includes(stripped.link) && newestDescribed(chain.links) === stripped.link) {
                stripped.link.ladder = stripped.ladder;
            }
            if (chain.links.length === 0) this.chains.delete(path);
        };
    }

    private chainOf(path: string): Chain {
        const chain = this.chains.get(path) ?? { links: [], carried: false, lost: 0 };
        this.chains.set(path, chain);
        return chain;
    }

    /**
     * The file changed on disk: a `modify` or a `create` came for it.
     *
     * Counted before anything decides whether to scan (a drag holds scans
     * back, not changes). A change a write of ours is waiting for is that
     * write landing, and the oldest waiting is taken: Obsidian sends one
     * `modify` per write, in order, and never merges two (F6's observation). A
     * change nothing of ours is waiting for came from outside — an editor's
     * save, a sync, another program — and the chain says so.
     */
    noteChange(path: string): void {
        const waiting = this.awaiting.get(path);
        if (waiting && waiting.length > 0) {
            waiting.shift();
            if (waiting.length === 0) this.awaiting.delete(path);
            return;
        }
        const chain = this.chainOf(path);
        const last = chain.links.at(-1);
        if (last && isForeign(last)) {
            last.filed = ++this.filed;
            return;
        }
        chain.links.push({ filed: ++this.filed, content: null, foreign: true });
        this.cap(chain);
    }

    /**
     * What the chain of one file holds, oldest first, and how many writes of
     * ours are still waiting for their `modify`. For a console or a test that
     * needs to see what was counted.
     *
     * @internal Read-only use.
     */
    peek(path: string): { links: Array<'record' | 'mark' | 'foreign'>; awaiting: number } {
        return {
            links: (this.chains.get(path)?.links ?? [])
                .map(link => (isForeign(link) ? 'foreign' : link.content === null ? 'mark' : 'record')),
            awaiting: this.awaiting.get(path)?.length ?? 0,
        };
    }

    /**
     * Forget everything about a file that is no longer there under this
     * path: its chain, and the writes waiting for a `modify` that will now
     * come under another name, or not at all.
     */
    dropFile(path: string): void {
        this.chains.delete(path);
        this.awaiting.delete(path);
    }

    /**
     * Keep the chain under {@link MAX_CHAIN_PER_FILE}, oldest links first, and
     * remember how far the loss reaches.
     */
    private cap(chain: Chain): void {
        const excess = chain.links.length - MAX_CHAIN_PER_FILE;
        if (excess <= 0) return;
        const dropped = chain.links.splice(0, excess);
        chain.lost = Math.max(chain.lost, dropped[dropped.length - 1].filed);
    }

    /**
     * What the last write of ours that no committed scan has read left in this
     * file: its rows, or null when it could not say. Undefined when every write
     * of ours to the file has been read by a scan that committed — the only
     * case where the ledger is not known to be older than one of them.
     *
     * Not the same as a write's `base` (see {@link reading}): a write does
     * not build on its newest write past a scan that committed without
     * reading it, and this one is dropped only by a scan that read the file
     * after the write (see {@link forget}).
     */
    lastWrite(path: string): { rows: readonly ClaimBase[] | null } | undefined {
        const newest = ownLinks(this.chains.get(path)?.links ?? []).at(-1);
        if (!newest) return undefined;
        return { rows: newest.content === null ? null : newest.rows };
    }

    /**
     * Every way the lines read may be told, from where they stand among the
     * states this file is known to have been in: the ledger's (element 0 of
     * the chain, written by scans alone and only read here), and each record
     * of a write of ours since. The one placing a scan and `locate` make of a
     * read (see `matchFile` for what is done with it).
     *
     * - A known state whose content is the read is a state the read may be.
     *   With nothing after it but writes of ours, it is the read, or the read
     *   came before those writes landed — both of which it answers for.
     * - A change nobody reported (an outside mark) after the newest such
     *   state says the file moved on after it: the read may be that state put
     *   back, or a change made after the newest state known that happens to
     *   read the same. So the read may also be "after", and the ladder pairs
     *   it against the newest state known. The lines cannot say which; a row
     *   keeps its name only where the two agree (E1: a record reached again by
     *   another route after its own write was undone).
     * - No known state with the read's content: the read is "after", as a
     *   change nobody reported. The newest state known is the partner:
     *   across a mark, the record beneath it, the write that could not say
     *   what it did being paired across like any edit nobody reported (F5b).
     * - Two known states with the read's content that name its rows
     *   differently are both open (K2): the file came back to a content it
     *   had, and when the read was is not in the lines.
     * - Once the cap has dropped states (`lost`), the read may be one of
     *   those, and none of this can be told: every row is new (`unknown`).
     *
     * A write asks the same question of the lines it was handed, and knows
     * one thing a scan does not: they came after every write of ours that
     * filed here, each of which landed or was taken back before this one was
     * handed the file (`WriteReceipt.withdraw`). So the ledger and the states
     * between are not states its lines may be. Lines that read as one of them
     * were put back by something else, which is a change after our newest
     * write, and are paired against what that write left. What is left is
     * the newest write of ours — or the ledger, with none — and, with an
     * outside change after it, a change that reads the same. Where our newest
     * write could not say what it left, or the cap has dropped states and the
     * lines are not, row by row, what our newest write left, nothing can be
     * told (`unknown`), and a write refuses. A
     * ledger older than a write it did not read (`carried`) is no state
     * either. Only a write gets a `base`.
     *
     * @param lines the lines read.
     * @param ledgerRows the ledger's rows as a ladder reads its previous
     *   side, for a read paired against the ledger.
     */
    reading(path: string, lines: readonly string[], reader: Reader, ledgerRows: readonly LedgerEntry[]): ReadPlace {
        const read = contentKeyOf(lines);
        const chain = this.chains.get(path);
        const links = chain?.links ?? [];
        const ledger = this.ledgerState(path);
        const own = ownLinks(links);
        const newestOwn = own.at(-1);
        const nothing: ReadPlace = { reading: UNKNOWN_READING, unknown: true, states: [], after: true, base: null };

        // The known states the read may be, each with the rows it holds.
        const candidates: Array<{ state: Described | 'ledger'; rows: readonly ClaimBase[]; at: number }> = [];
        const lost = chain !== undefined && chain.lost > 0;
        if (reader === 'scan') {
            if (lost) return nothing;
            if (ledger.content !== null) candidates.push({ state: 'ledger', rows: ledger.rows, at: -1 });
            links.forEach((link, at) => {
                if (link.content !== null) candidates.push({ state: link, rows: link.rows, at });
            });
        } else if (newestOwn) {
            if (newestOwn.content === null) return nothing;
            if (!chain!.carried) candidates.push({ state: newestOwn, rows: newestOwn.rows, at: links.indexOf(newestOwn) });
        } else if (ledger.content !== null) {
            candidates.push({ state: 'ledger', rows: ledger.rows, at: -1 });
        }

        const states: Array<Described | 'ledger'> = [];
        const exact: ExactState[] = [];
        let newest = -1;
        const content = (state: Described | 'ledger') => (state === 'ledger' ? ledger.content : state.content);
        for (const { state, rows, at } of candidates) {
            if (content(state) !== read) continue;
            states.push(state);
            exact.push({ rows: rows.map(row => ({ runtimeId: row.runtimeId, created: row.created, text: row.text })) });
            newest = at;
        }
        const after = states.length === 0 || links.slice(newest + 1).some(isForeign);
        const partner = newestDescribed(links)?.ladder ?? ledgerRows;

        let base: ClaimBase[] | null = null;
        if (reader === 'write') {
            const [only] = candidates;
            if (states.length === 1 && !after && fits(only.rows, lines)) base = [...only.rows];
            // No scan has committed the file, and the ledger has no rows: the
            // start-up scan skips a note with no list items, so this is every
            // such note until something writes to it. Nothing there has a name
            // anyone holds, and every row a write finds is new.
            else if (!newestOwn && ledger.content === null && ledger.rows.length === 0) base = [];
            // Past the cap, the lines our last write left are still known
            // row by row; anything else is paired, and that is not told.
            if (lost && base === null) return nothing;
        }
        return { reading: { states: exact, after, partner }, unknown: false, states, after, base };
    }

    /**
     * Whom the write of ours that last wrote this row, as the read holds it,
     * was made for — or null when no write of ours the read is known to hold
     * wrote the row, or the row reads otherwise than that write left it.
     *
     * Which writes a read holds comes from where it stands in the chain, the
     * placing by content alone that `placeRead` makes: an earlier or the newest write's
     * lines hold that write and every one before it; lines changed after the
     * newest described write hold every described write, and something else
     * besides; the ledger's own lines, and a read past the cap, hold none that
     * can be told.
     *
     * The text is what keeps "held" honest for a read that changed after our
     * writes: a row whose line was rewritten since is not the one our write
     * left, whoever named it. Asked only about rows a scan is deciding on, and
     * before the scan's commit forgets the chain.
     *
     * @param read the key of the lines read.
     * @param ledger the key of the content the last scan recorded.
     */
    writerOf(path: string, read: ContentKey, ledger: ContentKey | null, runtimeId: string, text: string): WriteOrigin | null {
        const chain = this.chains.get(path);
        const own = ownLinks(chain?.links ?? []);
        if (!chain || own.length === 0) return null;
        const place = placeRead(own, chain.lost, read, ledger);
        let upTo: number;
        switch (place.kind) {
            case 'ledger':
            case 'unknown':
                return null;
            case 'earlier':
            case 'newest':
                upTo = place.at;
                break;
            case 'after':
                upTo = own.length - 1;
                break;
        }
        for (let i = upTo; i >= 0; i--) {
            const link = own[i];
            // A mark that could not say which rows it wrote may have written
            // this one, and may not: the rows before it cannot answer past it.
            if (link.content === null && (!link.wrote || !link.origin)) return null;
            const written = link.wrote!.get(runtimeId);
            if (written === undefined) continue;
            return written === text ? link.origin! : null;
        }
        return null;
    }

    /**
     * Whether the lines read are, whole, a state a write of ours left: an
     * earlier or the newest described write's. Such a read carries no change
     * from anywhere else — no editor's save, no sync — so it speaks for
     * nobody's hand (see `EditorSignal`).
     */
    leftByUs(path: string, read: ContentKey, ledger: ContentKey | null): boolean {
        const chain = this.chains.get(path);
        const own = ownLinks(chain?.links ?? []);
        if (!chain || own.length === 0) return false;
        const place = placeRead(own, chain.lost, read, ledger);
        return place.kind === 'earlier' || place.kind === 'newest';
    }

    /**
     * Every text the records of this file's writes, since the last scan, give
     * one row — as each left it.
     */
    textsOnRecord(path: string, runtimeId: string): string[] {
        const texts: string[] = [];
        for (const link of this.chains.get(path)?.links ?? []) {
            if (link.content === null) continue;
            for (const row of link.rows) if (row.runtimeId === runtimeId) texts.push(row.text);
        }
        return texts;
    }

    /**
     * A mark for a scan to take before it reads a file: a write filed after
     * it may be one the read did not see.
     */
    readMark(): number {
        return this.filed;
    }

    /**
     * Forget what this file's writes left.
     *
     * Called when a scan of the file commits, whatever it decided, and when the
     * file's records are dropped for good (`tv-ignore`; a rename or a delete
     * is {@link dropFile}). A committing scan says what it read (`seen`): the
     * mark it took before reading, and the placing {@link reading} made of the
     * lines — the one the match it commits was made from. What it keeps is what
     * the ledger it commits may not have seen, never built on again (see
     * {@link lastWrite}):
     *
     * - lines that are one known state and nothing else: the read saw that
     *   state and every one before it; the links after it are kept. For the
     *   ledger's own lines, that is what the read-mark keeps: a write filed
     *   after it may have landed after the read;
     * - lines that changed after the newest record, and nothing else: the
     *   read saw every record, and none is kept. Keeping one would leave the
     *   chain saying the new ledger is older than a write it has read, and the
     *   next read would pair against a state older than the ledger. Marks are
     *   kept as the read-mark decides: a mark's own content is not known, so
     *   the read may not have seen it;
     * - lines that may be more than one of these, or past the cap: the
     *   read-mark decides.
     *
     * A record the read saw the file move on from by a change nobody reported
     * goes with the commit whatever the placing: that change filed its mark
     * before the scan began, so the record did too, and only what filed after
     * the read-mark is kept past a read that is not one state alone. Kept, it
     * would be weighed against a later read as if its own write had put the
     * file there, when only another route can (E1).
     */
    forget(path: string, seen?: { readMark: number; place: ReadPlace }): void {
        const chain = this.chains.get(path);
        if (!chain) return;
        if (seen === undefined) {
            this.chains.delete(path);
            return;
        }
        const { readMark, place } = seen;
        const unread = (link: Link): boolean => link.filed > readMark;
        let keep: (link: Link, at: number) => boolean;
        const [only] = place.states;
        if (!place.unknown && place.states.length === 1 && !place.after && only !== 'ledger') {
            const from = chain.links.indexOf(only as Link);
            keep = (link, at) => at > from || (isForeign(link) && unread(link));
        } else if (!place.unknown && place.states.length === 0) {
            keep = link => link.content === null && unread(link);
        } else {
            keep = link => unread(link);
        }
        chain.links = chain.links.filter((link, at) => keep(link, at));
        if (chain.links.length === 0) {
            this.chains.delete(path);
            return;
        }
        // Outside changes alone kept say nothing of the ledger being older
        // than a write of ours.
        chain.carried = ownLinks(chain.links).length > 0;
        if (chain.lost <= readMark) chain.lost = 0;
    }
}

/**
 * Where a read of `read` stands among the writes of ours, by content alone,
 * outside changes not counted — the placing the firing's questions
 * (`writerOf`, `leftByUs`) have been answered with since F6, and which stage X
 * is to reconsider; identity's placing is {@link WriteClaims.reading}:
 * the ledger's own lines; the lines an earlier described write left (`at`,
 * its index); the newest described write's (`at`); lines that are none of
 * these, so changed after the newest described write; or, past the cap, not
 * known.
 */
function placeRead(
    links: readonly Link[],
    lost: number,
    read: ContentKey,
    ledger: ContentKey | null,
):
    | { kind: 'ledger' }
    | { kind: 'earlier'; at: number }
    | { kind: 'newest'; at: number }
    | { kind: 'after' }
    | { kind: 'unknown' } {
    if (ledger !== null && read === ledger) return { kind: 'ledger' };
    const newest = newestDescribed(links);
    const at = links.findIndex(link => link.content === read);
    if (newest && newest.content === read) return { kind: 'newest', at: links.lastIndexOf(newest) };
    if (at >= 0) return { kind: 'earlier', at };
    if (lost > 0) return { kind: 'unknown' };
    return { kind: 'after' };
}

/** The newest link of the chain that describes what it left, if any. */
function newestDescribed(links: readonly Link[]): Described | undefined {
    for (let i = links.length - 1; i >= 0; i--) {
        const link = links[i];
        if (link.content !== null) return link;
    }
    return undefined;
}

/**
 * Whether each row still reads its own text on its own line.
 *
 * Asked of a state whose content key the lines already have (see
 * `WriteClaims.reading`). The whole content catches every writer that does
 * not report — frontmatter, headings, an edit from outside all move rows
 * without touching one — and the rows are checked as well because the content
 * is compared by key (see `ContentKey`): two contents sharing a key would also
 * have to put every row's text on the row's line before a write built on the
 * wrong one.
 */
function fits(rows: readonly ClaimBase[], lines: readonly string[]): boolean {
    for (const row of rows) {
        if (row.line < 0 || row.line >= lines.length) return false;
        if (lines[row.line] !== row.text) return false;
    }
    return true;
}
