import { t } from '../i18n';
import type { SendingLines } from '../services/data/NoteOps';
import { TaskLineClassifier } from '../services/parsing/utils/TaskLineClassifier';
import { targetOf, type TimerState } from './TimerState';

/**
 * Whether the open timers let rows go to a note (the send operation,
 * `NoteOps.send`; `archive/2026-09-send.md`, 開いているタイマー). A timer finds its lines by their
 * `^id`s in its note (`file`), so a send that carries them away must
 * take the timer along, and one that would leave it without its lines is
 * not made.
 */

/** An open timer as the check sees it: its name, its note, and the `^id`s it finds its lines by ({@link anchorsOf}). */
export interface AnchoredTimer {
    name: string;
    file: string;
    anchors: readonly string[];
}

/**
 * The `^id`s a timer finds its lines by: its target's (`targetOf`) and its
 * tail's, and the tail of the write it is making (`opening`), which is its
 * tail once the write lands. Not `owned`: those are the ones it is to take
 * off, not the ones it looks up. A timer with none (one on a daily note
 * whose first write has not been asked) has nothing a send could take away.
 */
export function anchorsOf(timer: Pick<TimerState, 'subject' | 'tail' | 'opening'>): string[] {
    const ids = [targetOf(timer), timer.tail, timer.opening?.tail];
    return [...new Set(ids.filter((id): id is string => !!id))];
}

/**
 * What the check found: nothing keeps the send; or the first timer it would
 * leave without its lines — some of its `^id`s go and some stay (`split`),
 * the draft took one of those that go off or changed it (`lost`), or the
 * note the timer finds its lines in once sent would carry one of them on two
 * lines, which anchor neither (`shared`).
 */
export type TimerSendVerdict =
    | { kind: 'clear' }
    | { kind: 'split'; timer: string; sent: string; kept: string }
    | { kind: 'lost'; timer: string; anchor: string }
    | { kind: 'shared'; timer: string; anchor: string; note: string };

/**
 * Check a send (`sending`) against the open timers.
 *
 * A timer whose note rows go from, and some of whose `^id`s are in the lines
 * of those rows as the send was planned on them, goes with them: all of its
 * `^id`s must be there (else `split`: its records would go on being written
 * away from its task — the same within the rows' own note), and all must be
 * in the lines that go, as the draft left them (else `lost`). It then finds
 * its lines in the note sent to.
 *
 * In the note sent to, each `^id` is carried once the send is made by as
 * many lines as it is now, less those of the note's own rows as they were,
 * plus those of every row as it goes. A timer that goes there, or is there
 * already, needs each of its `^id`s on one line (else `shared`). One that is
 * there already is kept from the send only by an `^id` the send carries
 * more of: one on two lines before the send is not the send's doing.
 */
export function checkTimerSend(timers: readonly AnchoredTimer[], sending: SendingLines): TimerSendVerdict {
    const from = new Map(sending.from.map(note => [note.path, {
        base: TaskLineClassifier.blockIdCounts(note.base),
        sent: TaskLineClassifier.blockIdCounts(note.sent),
    }]));
    // How many more lines of the note sent to carry each `^id` once sent.
    const added = new Map<string, number>();
    const add = (counts: ReadonlyMap<string, number>, sign: number) => {
        for (const [id, n] of counts) added.set(id, (added.get(id) ?? 0) + sign * n);
    };
    for (const [path, note] of from) {
        add(note.sent, 1);
        if (path === sending.to) add(note.base, -1);
    }

    for (const timer of timers) {
        if (timer.anchors.length === 0) continue;
        const of = from.get(timer.file);
        const going = of ? timer.anchors.filter(id => of.base.has(id)) : [];
        let goes = false;
        if (of && going.length > 0) {
            const kept = timer.anchors.find(id => !of.base.has(id));
            if (kept !== undefined) return { kind: 'split', timer: timer.name, sent: going[0], kept };
            const lost = timer.anchors.find(id => !of.sent.has(id));
            if (lost !== undefined) return { kind: 'lost', timer: timer.name, anchor: lost };
            goes = timer.file !== sending.to;
        }
        if (!goes && timer.file !== sending.to) continue;
        for (const id of timer.anchors) {
            const more = added.get(id) ?? 0;
            const after = (sending.inNote.get(id) ?? 0) + more;
            if (after >= 2 && (goes || more > 0)) return { kind: 'shared', timer: timer.name, anchor: id, note: sending.to };
        }
    }
    return { kind: 'clear' };
}

/** A verdict that keeps a send, as the one sentence the dialog shows under its fields and a notice gives. */
export function timerSendText(verdict: Exclude<TimerSendVerdict, { kind: 'clear' }>): string {
    switch (verdict.kind) {
        case 'split': return t('notice.sendTimerSplit', { timer: verdict.timer, sent: verdict.sent, kept: verdict.kept });
        case 'lost': return t('notice.sendTimerLost', { timer: verdict.timer, anchor: verdict.anchor });
        case 'shared': return t('notice.sendTimerShared', { timer: verdict.timer, anchor: verdict.anchor, note: verdict.note });
    }
}
