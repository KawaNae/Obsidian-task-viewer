import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Notice, setMockLocale } from 'obsidian';
import { initI18n, t } from '../../../src/i18n';
import { FlowExecutor, type FireOp, type FirePlan } from '../../../src/services/flow/FlowExecutor';
import { FlowNotices, notRunsOf } from '../../../src/services/flow/FlowNotices';
import type { Refusal } from '../../../src/services/persistence/FileLines';
import type { FiringOutcome } from '../../../src/services/persistence/FiringTrials';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * What the user is told of a completion's fires (`FlowNotices`): the one rule
 * of it (`notRunsOf`), for a card's write, a send and the editor's
 * transaction alike, and the window that keeps a failure from being said
 * twice in a row.
 */

function makeExecutor() {
    const taskIndex = { getTask: vi.fn(() => undefined), getGenBlock: vi.fn(() => undefined) };
    return new FlowExecutor({} as never, taskIndex as never, {} as never, () => DEFAULT_SETTINGS);
}

/** A fire whose write's last run planned `plan`. */
function fireOf(plan: FirePlan | null): FireOp {
    return { op: { kind: 'fire', plan: () => [] }, planned: () => plan };
}

/** A write made, with these fires in the order their rows stand. */
function made(...fires: Array<{ fire: FireOp; setAside: Refusal | null }>): FiringOutcome<FireOp> {
    return { written: true, refused: null, fires };
}

const refusal: Refusal = { file: 'note.md', reason: { kind: 'disturbs', fence: null }, subject: '- [x] B' };

/** The plan of the row `- [x] Test task @2026-06-29 ==> command`, as a write plans it. */
function planned(executor: FlowExecutor, command: string, file = 'notes/週報.md'): FireOp {
    const fire = executor.fireOp(file);
    fire.op.plan([`- [x] Test task @2026-06-29 ==> ${command}`], 0);
    return fire;
}

describe('notRunsOf: what the user is owed of a write that may have completed rows', () => {
    it('owes nothing of a write refused: that is told as a refusal', () => {
        expect(notRunsOf({ written: false, refused: refusal })).toEqual([]);
    });

    it('owes, for each row in the order they stand, the refusal its fire was set aside with, else its failed plan, else nothing', () => {
        const executor = makeExecutor();
        const failed = planned(executor, 'at(end + 1d)');
        const fired = planned(executor, 'at(today + 1d)');
        const plan = failed.planned();
        expect(plan?.kind).toBe('failed');

        expect(notRunsOf(made(
            { fire: failed, setAside: null },
            { fire: fired, setAside: null },
            { fire: fired, setAside: refusal },
            { fire: fireOf(null), setAside: null },
            { fire: fireOf({ kind: 'none' }), setAside: null },
        ))).toEqual([plan, { kind: 'refused', refusal }]);
    });

    it('owes the refusal of a fire set aside, whatever its plan answered', () => {
        // A fire set aside was planned to write lines; what the user needs to
        // hear is why they could not be written.
        const failed = planned(makeExecutor(), 'at(end + 1d)');

        expect(notRunsOf(made({ fire: failed, setAside: refusal }))).toEqual([{ kind: 'refused', refusal }]);
    });
});

describe('a fire that does not happen says so', () => {
    // 非発火・非消費は設計どおりだが、外から見えるのは「チェックしても何も
    // 起きないチェックボックス」。ログしか残らないと、タスクを触っている人
    // には何も届かない。
    beforeEach(() => {
        Notice.messages.length = 0;
    });

    /** Complete a row whose command is `command`, as a write does, and tell what it owes once it landed. */
    function complete(notices: FlowNotices, executor: FlowExecutor, command: string): void {
        notices.firing(made({ fire: planned(executor, command), setAside: null }));
    }

    it('shows what stopped it, and which task it was', () => {
        complete(new FlowNotices(), makeExecutor(), 'at(end + 1d)');

        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("Property 'end' is not set on this task");
        expect(Notice.messages[0]).toContain('(Test task)');
    });

    it('says it once while the same task keeps failing the same way', () => {
        // 直すために付けたり外したりする間、同じ文言が積み上がるとファイル
        // 自体が見えなくなる。
        const notices = new FlowNotices();
        const executor = makeExecutor();

        complete(notices, executor, 'at(end + 1d)');
        complete(notices, executor, 'at(end + 1d)');

        expect(Notice.messages).toHaveLength(1);
    });

    it('says the next failure, since it is a different thing to fix', () => {
        const notices = new FlowNotices();
        const executor = makeExecutor();

        complete(notices, executor, 'at(end + 1d)');
        // 同じタスクの別の失敗。窓は「同じ失敗」に効くのであって、
        // 「そのタスクを黙らせる」ためのものではない。
        complete(notices, executor, 'at(due + 1d)');

        expect(Notice.messages).toHaveLength(2);
        expect(Notice.messages[1]).toContain("Property 'due' is not set on this task");
    });

    it('says a fire set aside every time: the note refused it as it reads now', () => {
        const notices = new FlowNotices();

        notices.firing(made({ fire: fireOf(null), setAside: refusal }));
        notices.firing(made({ fire: fireOf(null), setAside: refusal }));

        const said = t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] B' });
        expect(Notice.messages).toEqual([said, said]);
    });

    it('says it in the reader language', () => {
        // 理由の英文はエンジンが投げた場所で書かれている。通知はそれをそのまま
        // 出すのではなく code で引き直すので、日本語の vault では日本語になる。
        setMockLocale('ja');
        initI18n();
        try {
            complete(new FlowNotices(), makeExecutor(), 'at(end + 1d)');
        } finally {
            setMockLocale('en');
            initI18n();
        }

        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toContain("このタスクにプロパティ 'end' は設定されていません");
    });

    it('stays quiet on a command that does not read: nothing fires, and the editor marks the error', () => {
        // move() はノートの見出しを指していないので、コマンドは構文の誤り。
        // 発火そのものが起きず、告げることも無い。
        complete(new FlowNotices(), makeExecutor(), 'every mon move()');

        expect(Notice.messages).toEqual([]);
    });

    it('stays quiet when the fire went through', () => {
        complete(new FlowNotices(), makeExecutor(), 'at(today + 1d)');

        expect(Notice.messages).toEqual([]);
    });
});
