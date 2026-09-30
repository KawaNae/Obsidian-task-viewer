import { describe, it, expect } from 'vitest';
import { t } from '../../../src/i18n';
import { anchorsOf, checkTimerSend, timerSendText, type AnchoredTimer } from '../../../src/timer/TimerSendCheck';
import type { SendingLines } from '../../../src/services/data/NoteOps';

/**
 * Whether the open timers let rows go to a note (`archive/2026-09-send.md`, 開いているタイマー):
 * a timer whose `^id`s all go follows them; one whose `^id`s would go in
 * part, be lost to the draft, or be carried by two lines of the note it
 * finds its lines in keeps the send from being made.
 */

const timer = (file: string, anchors: string[], name = 'T'): AnchoredTimer => ({ name, file, anchors });

/** A send to `to` of the rows of `from`, each as it was and as it goes (the base when no draft). */
function sending(to: string, from: Record<string, { base: string[]; sent?: string[] }>, inNote: Record<string, number> = {}): SendingLines {
    return {
        to,
        inNote: new Map(Object.entries(inNote)),
        from: Object.entries(from).map(([path, { base, sent }]) => ({ path, base, sent: sent ?? base })),
    };
}

const CONTAINER = ['- [ ] 器 ^tv-t-target', '    - [ ] 記録 @2026-09-30T09:00 ^tv-t-tail'];

describe('a timer whose ^ids all go: the send is made', () => {
    it('child: the target is the row, the tail a record under it', () => {
        expect(checkTimerSend([timer('a.md', ['tv-t-target', 'tv-t-tail'])], sending('X.md', { 'a.md': { base: CONTAINER } })))
            .toEqual({ kind: 'clear' });
    });

    it('self: the row is target and tail', () => {
        expect(checkTimerSend([timer('a.md', ['s'])], sending('X.md', { 'a.md': { base: ['- [ ] 行 @2026-09-30T09:00 ^s'] } })))
            .toEqual({ kind: 'clear' });
    });

    it('started from a daily note: the tail alone, sent', () => {
        expect(checkTimerSend([timer('2026-09-30.md', ['tail'])], sending('X.md', { '2026-09-30.md': { base: ['- [ ] 記録 ^tail'] } })))
            .toEqual({ kind: 'clear' });
    });

    it('within its own note, to another heading', () => {
        expect(checkTimerSend([timer('a.md', ['tv-t-target', 'tv-t-tail'])], sending('a.md', { 'a.md': { base: CONTAINER } }, { 'tv-t-target': 1, 'tv-t-tail': 1 })))
            .toEqual({ kind: 'clear' });
    });
});

describe('the timers the send does not touch', () => {
    it('one with no ^id, one of another note by the same ^id, and one none of whose ^ids go', () => {
        const timers = [timer('a.md', []), timer('b.md', ['tv-t-target', 'x']), timer('a.md', ['elsewhere', 'other'])];
        expect(checkTimerSend(timers, sending('X.md', { 'a.md': { base: CONTAINER } }))).toEqual({ kind: 'clear' });
    });
});

describe('a timer some of whose ^ids go and some stay: refused', () => {
    it('sibling: the target sent, the records beside it staying', () => {
        expect(checkTimerSend([timer('a.md', ['target', 'tail'], '器')], sending('X.md', { 'a.md': { base: ['- [x] 器 ^target'] } })))
            .toEqual({ kind: 'split', timer: '器', sent: 'target', kept: 'tail' });
    });

    it('the tail alone sent, the target staying', () => {
        expect(checkTimerSend([timer('a.md', ['target', 'tail'])], sending('X.md', { 'a.md': { base: ['- [ ] 記録 ^tail'] } })))
            .toMatchObject({ kind: 'split', sent: 'tail', kept: 'target' });
    });

    it('within its own note too', () => {
        expect(checkTimerSend([timer('a.md', ['target', 'tail'])], sending('a.md', { 'a.md': { base: ['- [x] 器 ^target'] } }, { target: 1, tail: 1 })))
            .toMatchObject({ kind: 'split' });
    });

    it('the line a write of the timer is putting in, not yet in the note, counted as staying', () => {
        const anchors = anchorsOf({ timerTargetId: 's', tailRecordBlockId: 's', opening: { tail: 'next', target: 's', owned: [] } });
        expect(anchors).toEqual(['s', 'next']);
        expect(checkTimerSend([timer('a.md', anchors)], sending('X.md', { 'a.md': { base: ['- [ ] 行 ^s'] } })))
            .toMatchObject({ kind: 'split', sent: 's', kept: 'next' });
    });
});

describe('a draft that takes off or changes a timer\'s ^id: refused', () => {
    it('taken off', () => {
        expect(checkTimerSend([timer('a.md', ['tv-t-target', 'tv-t-tail'])], sending('X.md', {
            'a.md': { base: CONTAINER, sent: ['- [ ] 器 ^tv-t-target', '    - [ ] 記録 @2026-09-30T09:00'] },
        }))).toMatchObject({ kind: 'lost', anchor: 'tv-t-tail' });
    });

    it('changed, within its own note too', () => {
        expect(checkTimerSend([timer('a.md', ['tv-t-target', 'tv-t-tail'])], sending('a.md', {
            'a.md': { base: CONTAINER, sent: ['- [ ] 器 ^tv-t-other', '    - [ ] 記録 ^tv-t-tail'] },
        }, { 'tv-t-target': 1, 'tv-t-tail': 1 }))).toMatchObject({ kind: 'lost', anchor: 'tv-t-target' });
    });
});

describe('a timer whose ^id the note it ends in would carry on two lines: refused', () => {
    it('one that goes, to a note carrying its ^id already', () => {
        expect(checkTimerSend([timer('a.md', ['tv-t-target', 'tv-t-tail'])], sending('X.md', { 'a.md': { base: CONTAINER } }, { 'tv-t-tail': 1 })))
            .toEqual({ kind: 'shared', timer: 'T', anchor: 'tv-t-tail', note: 'X.md' });
    });

    it('one of the note sent to, whose ^id a row brings', () => {
        expect(checkTimerSend([timer('X.md', ['x'])], sending('X.md', { 'a.md': { base: ['- [ ] A ^x'] } }, { x: 1 })))
            .toMatchObject({ kind: 'shared', anchor: 'x' });
    });

    it('rows of two notes bringing the same ^id', () => {
        expect(checkTimerSend([timer('a.md', ['d'])], sending('X.md', { 'a.md': { base: ['- [ ] A ^d'] }, 'b.md': { base: ['- [ ] B ^d'] } })))
            .toMatchObject({ kind: 'shared', anchor: 'd' });
    });

    it('a draft within the note that writes another line\'s ^id', () => {
        expect(checkTimerSend([timer('a.md', ['x'])], sending('a.md', { 'a.md': { base: ['- [ ] A'], sent: ['- [ ] A ^x'] } }, { x: 1 })))
            .toMatchObject({ kind: 'shared', anchor: 'x' });
    });

    it('but not one of the note sent to whose ^id was on two lines before, the send bringing none', () => {
        expect(checkTimerSend([timer('X.md', ['x'])], sending('X.md', { 'a.md': { base: ['- [ ] A ^a'] } }, { x: 2 })))
            .toEqual({ kind: 'clear' });
    });
});

describe('what the dialog and the notice say', () => {
    it('one sentence for each', () => {
        expect(timerSendText({ kind: 'split', timer: '器', sent: 'a', kept: 'b' })).toBe(t('notice.sendTimerSplit', { timer: '器', sent: 'a', kept: 'b' }));
        expect(timerSendText({ kind: 'lost', timer: '器', anchor: 'a' })).toBe(t('notice.sendTimerLost', { timer: '器', anchor: 'a' }));
        expect(timerSendText({ kind: 'shared', timer: '器', anchor: 'a', note: 'X.md' })).toBe(t('notice.sendTimerShared', { timer: '器', anchor: 'a', note: 'X.md' }));
    });
});
