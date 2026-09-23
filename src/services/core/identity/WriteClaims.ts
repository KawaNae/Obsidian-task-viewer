import type { ParserId, Task } from '../../../types';
import type { Hint } from './IdentityHints';
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

/** What a write claims, and a handle that takes the whole call back. */
export interface ClaimResult {
    /** What the file now reads, or null when this write cannot say. */
    hint: Hint | null;
    /**
     * Undo everything this call left behind.
     *
     * A claim is filed from inside `vault.process`, before the write is known
     * to have landed (see `processLines`), and what it leaves behind is not
     * only the hint the caller holds: it is also the base the *next* write to
     * this file would build on. A write that threw, or whose callback
     * Obsidian ran again, must leave neither.
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
 * scan reaches again, which must not grow without bound. A link past the
 * newest described one is a key and a number, so the cap costs well under a
 * hundred bytes a link.
 */
export const MAX_CHAIN_PER_FILE = 1024;

/**
 * One write of ours to a file that the ledger has not read, as it landed.
 *
 * Either described — the key of the content the write left, and, for the
 * newest described link only, the rows in it (`state`) — or a mark: a write
 * landed that this class could not describe, so nothing it holds is true of
 * the file any more, and nothing older is either.
 *
 * `filed` numbers the writes in the order they landed (see
 * {@link WriteClaims.readMark}).
 *
 * A described link also says whom the write was made for, and which rows it
 * wrote — made, or gave a new text — with the text it gave each. That is what
 * lets a scan answer, row by row, whether a completion it reads is one a write
 * of ours made and for whom (see {@link WriteClaims.writerOf}). Unlike the
 * rows, every described link keeps it: a read can be of any state in the
 * chain, and what an older write wrote is what such a read holds.
 */
type Link =
    | { filed: number; content: ContentKey; state: LinkState | null; origin: WriteOrigin; wrote: ReadonlyMap<string, string> }
    | { filed: number; content: null };

interface LinkState {
    /** The rows, as the next write builds on them and `locate` reads them. */
    rows: ClaimBase[];
    /** The same rows, as a ladder reads its previous side. */
    ladder: LedgerEntry[];
}

/**
 * Every write of ours to one file that the ledger has not read, in the order
 * they landed.
 *
 * Not only the last: the question a scan will put to this chain — is what I
 * read some state our own writes left, or a change that came after the last
 * of them — takes every state, because a read can land between two writes.
 * Only the newest described state keeps its rows. The older ones are only
 * ever compared, by key.
 */
interface Chain {
    links: Link[];
    /**
     * A scan committed without having read these writes: it read the file
     * before they landed, and committed after. Its ledger is older than them,
     * and {@link WriteClaims.stateFor} builds on neither.
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

    /** How many writes have filed here, described or not. */
    private filed = 0;

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
    ): ClaimResult {
        // Every way out of here without a claim is the same situation: this
        // write changed the file — `processLines` calls a sink for nothing
        // else — and nothing here can say what the file now is. Leaving no
        // link would say the opposite, that the state before it may be built
        // on again, and that state is older now. So the file is marked
        // instead, and stays marked until a scan of it commits.
        const nothing = (): ClaimResult => ({ hint: null, withdraw: this.silence(path), made: [] });

        if (edits === null) return nothing();

        const base = this.stateFor(path, before);
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
        const withdraw = this.append(path, { filed: ++this.filed, content, state: { rows, ladder }, origin, wrote });
        return {
            hint: { content, rows: rows.map(row => ({ runtimeId: row.runtimeId, created: row.created, text: row.text })), origin },
            withdraw,
            made,
        };
    }

    /**
     * Mark that a write of ours changed this file and nothing here can say
     * how — for when even {@link claim} could not run. The same mark a claim
     * that cannot say leaves, and taken back the same way.
     */
    silence(path: string): () => void {
        return this.append(path, { filed: ++this.filed, content: null });
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
    private append(path: string, link: Link): () => void {
        const chain = this.chains.get(path) ?? { links: [], carried: false, lost: 0 };
        this.chains.set(path, chain);

        // Only the newest described link keeps its rows.
        let stripped: { link: Link & { content: ContentKey }; state: LinkState } | null = null;
        if (link.content !== null) {
            const previous = newestDescribed(chain.links);
            if (previous?.state) {
                stripped = { link: previous, state: previous.state };
                previous.state = null;
            }
        }
        chain.links.push(link);
        this.cap(chain);

        return () => {
            const current = this.chains.get(path);
            if (current !== chain) return;
            const at = chain.links.indexOf(link);
            if (at < 0) return;
            const next = chain.links[at + 1];
            if (next && next.content !== null) return;
            chain.links.splice(at, 1);
            if (stripped && chain.links.includes(stripped.link) && newestDescribed(chain.links) === stripped.link) {
                stripped.link.state = stripped.state;
            }
            if (chain.links.length === 0) this.chains.delete(path);
        };
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
     * Not the same as the base {@link stateFor} builds on: that one is not
     * built on past any scan that commits, this one is dropped only by a scan
     * that read the file after the write (see {@link forget}).
     */
    lastWrite(path: string): { rows: readonly ClaimBase[] | null } | undefined {
        const newest = this.chains.get(path)?.links.at(-1);
        if (!newest) return undefined;
        return { rows: newest.content === null ? null : newest.state?.rows ?? null };
    }

    /**
     * What a ladder over these lines pairs against: the newest state of the
     * file that is known to be older than what was read.
     *
     * The ledger is the state the last scan read. Once a write of ours has
     * landed after it, the ledger is older than that write, and a ladder that
     * pairs against it pairs across our own writes as well as whatever came
     * after them — two writes that traded the texts of two rows hand each
     * name to the other's line (F2's S2c). The chain says what those writes
     * left, so when the lines are known to have changed after the last of
     * them, the ladder pairs against what the last described write left.
     * Across a mark, that is the state beneath it: the write that could not
     * say what it did is paired across like any edit nobody reported.
     *
     * "Known to have changed after the last of them" takes every state the
     * file was in since the ledger. A read can land between two of our writes,
     * and a read of an earlier state paired against a later one hands names
     * to rows in the order the later one has them. So:
     *
     * - lines the ledger recorded, whole, are the ledger's: their content
     *   names that state. If the newest write left the same content with
     *   the names moved, which one was read is not something the lines can
     *   say, and the ladder answers as it did before any of this;
     * - lines an earlier write of the chain left are ledger's too, for the
     *   same reason: the read may have been of that moment, and the state a
     *   write left is not paired against as a whole — that would adopt, by
     *   the ladder's door, a claim the log has dropped;
     * - lines that are none of these changed after our last write, and the
     *   newest state we know is the partner;
     * - and when the cap has dropped earlier states (`lost`), "none of these"
     *   cannot be told from a dropped state, and no partner is safe: the
     *   ledger is older than our writes, the newest state may be newer than
     *   the read. The answer is null: a scan makes every row new, the one
     *   answer that hands no name to the wrong row, and a write refuses.
     *
     * @param read the key of the lines read.
     * @param ledger what the last scan recorded: its content key and its rows.
     */
    ladderFor(
        path: string,
        read: ContentKey,
        ledger: { content: ContentKey | null; rows: readonly LedgerEntry[] },
    ): readonly LedgerEntry[] | null {
        const chain = this.chains.get(path);
        if (!chain) return ledger.rows;
        const place = placeRead(chain, read, ledger.content);
        switch (place.kind) {
            case 'ledger':
            case 'earlier':
                return ledger.rows;
            case 'unknown':
                return null;
            case 'newest':
            case 'after':
                return newestDescribed(chain.links)?.state?.ladder ?? ledger.rows;
        }
    }

    /**
     * Whom the write of ours that last wrote this row, as the read holds it,
     * was made for — or null when no write of ours the read is known to hold
     * wrote the row, or the row reads otherwise than that write left it.
     *
     * Which writes a read holds comes from where it stands in the chain, the
     * same placing {@link ladderFor} makes: an earlier or the newest write's
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
        if (!chain) return null;
        const place = placeRead(chain, read, ledger);
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
                upTo = chain.links.length - 1;
                break;
        }
        for (let i = upTo; i >= 0; i--) {
            const link = chain.links[i];
            if (link.content === null) continue;
            const written = link.wrote.get(runtimeId);
            if (written === undefined) continue;
            return written === text ? link.origin : null;
        }
        return null;
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
     * file's claims are dropped for good (a rename, a delete, `tv-ignore`). A
     * committing scan says what it read (`seen`): the mark it took before
     * reading, the key of the lines, and the ledger's content before the
     * commit. What it keeps is what the ledger it commits may not have seen,
     * never built on again (see {@link lastWrite}), and which that is comes
     * from where the read stands in the chain — the same placing
     * {@link ladderFor} made for the match this scan committed:
     *
     * - lines that are an earlier write's: the read saw that write and every
     *   one before it; the ones after it are kept;
     * - lines that are the newest described write's, or that changed after
     *   it: the read saw every described write, and none is kept. Keeping one
     *   would leave the chain saying the new ledger is older than a write it
     *   has read, and the next unmatched read would pair against a state
     *   older than the ledger. Marks are kept as the mark decides below: a
     *   mark's own content is not known, so the read may not have seen it;
     * - otherwise (the ledger's own lines, or no placing at all) the mark
     *   decides: a write filed after it may have landed after the read.
     */
    forget(path: string, seen?: { readMark: number; read: ContentKey; ledger: ContentKey | null }): void {
        const chain = this.chains.get(path);
        if (!chain) return;
        if (seen === undefined) {
            this.chains.delete(path);
            return;
        }
        const { readMark } = seen;
        const place = placeRead(chain, seen.read, seen.ledger);
        const unread = (link: Link): boolean => link.filed > readMark;
        switch (place.kind) {
            case 'earlier':
                chain.links = chain.links.slice(place.at + 1);
                break;
            case 'newest':
                chain.links = chain.links.slice(place.at + 1);
                break;
            case 'after':
                chain.links = chain.links.filter(link => link.content === null && unread(link));
                break;
            case 'ledger':
            case 'unknown':
                chain.links = chain.links.filter(unread);
                break;
        }
        if (chain.links.length === 0) {
            this.chains.delete(path);
            return;
        }
        chain.carried = true;
        if (chain.lost <= readMark) chain.lost = 0;
    }

    /**
     * The rows these lines are known to hold: what the last write left, else
     * what the last scan recorded, else nothing.
     *
     * Asked about the lines a write was handed, before it changes them, and by
     * two parties: the write's claim builds on the answer, and the write's
     * `locate` reads its target's coordinate off it (see `TaskScanner.locate`).
     * A coordinate is good only inside the content it was read from, and this
     * is the one place that says which content that is.
     *
     * Either candidate is a guess about a file this code did not read, so it is
     * checked rather than trusted, and both are checked the same way: the file
     * has to read, whole, as the candidate says it did — the same comparison a
     * scan makes when it weighs a claim (see `reproduces`) — and each of the
     * candidate's rows has to read its own text on its own line.
     *
     * The whole content, because rows alone say nothing about the lines between
     * them. A file is written by plenty that do not report — a write that
     * reports nothing, a report that did not account for its own file, a
     * writer with no sink at all, frontmatter and headings, which move every
     * row below them without touching a row — and an external edit reports to
     * nobody. Each leaves the candidate describing a file that is no longer
     * there, and the one comparison catches all of them, so nothing has to be
     * delivered to this class for it to know.
     *
     * The rows as well, because the content is compared by key (see
     * `ContentKey`). Two contents sharing a key would also have to put every
     * row's text on the row's line before a claim were built on the wrong one.
     *
     * A chain that is there at all stops the search rather than falling
     * through, whether or not its newest link still fits. Its presence says a
     * write of ours landed after the last scan committed, so the ledger
     * describes a file at least two writes old — and stale in the direction
     * that matters: the rows it holds sit at the line numbers the file had
     * *before* our own write moved them. That is why a refusal leaves a mark
     * behind instead of no link: the answer has to stay "nothing" for every
     * write until a scan commits, not just for the one that noticed.
     *
     * *No* chain is not a promise that the ledger is current: {@link forget}
     * drops what a committing scan read, whatever the ledger it commits.
     * Before scans handed over the mark they took before reading, a scan that
     * read the file as it was before our last write, and committed after that
     * write filed, took the base with it and left the next write a ledger one
     * write old. Handed a copy inserted above its original, that ledger's row
     * names the copy — the text there is the same word, so its rows still
     * fit. What refuses it is its content: the ledger recorded the file before
     * the copy, and the file this write was handed has it. Checked by rows
     * alone, the copy would be claimed as the original with every text lining
     * up, and a scan comparing whole contents would adopt it.
     *
     * The content does not refuse everything, though: our writes, and what
     * came after them, can bring the file back to the very content that ledger
     * recorded, with the names moved between its lines (delete X, append a
     * row, rename Y to X's text). So a commit keeps what the scan did not read
     * (`carried`), and while it is kept, the ledger is not answered with at
     * all.
     *
     * A file no scan has committed has no ledger content, and no rows either —
     * the start-up scan skips a note with no list items, so this is every such
     * note until something writes to it. Nothing there has a name anyone holds,
     * so there is nothing a claim could hand to the wrong line: every row the
     * write finds is new, and it builds on no rows at all.
     */
    stateFor(path: string, before: readonly string[]): ClaimBase[] | null {
        const current = contentKeyOf(before);

        const chain = this.chains.get(path);
        if (chain) {
            // A scan committed without having read a write of ours: its ledger
            // is older than that write however well the content fits. The
            // write and what came after it can bring the file back to the very
            // content the ledger recorded, with the names moved between its
            // lines.
            if (chain.carried) return null;
            const newest = chain.links.at(-1)!;
            if (newest.content === null || !newest.state) return null;
            return newest.content === current && fits(newest.state.rows, before) ? newest.state.rows : null;
        }

        const ledger = this.ledgerState(path);
        if (ledger.content === null) return ledger.rows.length === 0 ? [] : null;
        if (ledger.content === current && fits(ledger.rows, before)) return ledger.rows;

        return null;
    }
}

/**
 * Where a read of `read` stands in the chain (see `WriteClaims.ladderFor`):
 * the ledger's own lines; the lines an earlier described write left (`at`,
 * its index); the newest described write's (`at`); lines that are none of
 * these, so changed after the newest described write; or, past the cap, not
 * known.
 */
function placeRead(
    chain: Chain,
    read: ContentKey,
    ledger: ContentKey | null,
):
    | { kind: 'ledger' }
    | { kind: 'earlier'; at: number }
    | { kind: 'newest'; at: number }
    | { kind: 'after' }
    | { kind: 'unknown' } {
    if (ledger !== null && read === ledger) return { kind: 'ledger' };
    const newest = newestDescribed(chain.links);
    const at = chain.links.findIndex(link => link.content === read);
    if (newest && newest.content === read) return { kind: 'newest', at: chain.links.lastIndexOf(newest) };
    if (at >= 0) return { kind: 'earlier', at };
    if (chain.lost > 0) return { kind: 'unknown' };
    return { kind: 'after' };
}

/** The newest link of the chain that describes what it left, if any. */
function newestDescribed(links: readonly Link[]): (Link & { content: ContentKey }) | undefined {
    for (let i = links.length - 1; i >= 0; i--) {
        const link = links[i];
        if (link.content !== null) return link;
    }
    return undefined;
}

/** Whether each row still reads its own text on its own line. */
function fits(rows: readonly ClaimBase[], lines: readonly string[]): boolean {
    for (const row of rows) {
        if (row.line < 0 || row.line >= lines.length) return false;
        if (lines[row.line] !== row.text) return false;
    }
    return true;
}
