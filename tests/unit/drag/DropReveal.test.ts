import { describe, expect, it } from 'vitest';
import { DropReveal } from '../../../src/interaction/drag/DropReveal';
import { BaseDragStrategy } from '../../../src/interaction/drag/strategies/BaseDragStrategy';
import type { DragContext } from '../../../src/interaction/drag/DragStrategy';
import type { DragPlan } from '../../../src/interaction/drag/DragPlan';
import type { Task } from '../../../src/types';

/** classList だけを持つ最小の要素スタブ（vitest は node environment）。 */
function makeEl(...classes: string[]): HTMLElement & { classes: Set<string> } {
    const set = new Set(classes);
    const el = {
        classes: set,
        classList: {
            add: (...c: string[]) => c.forEach(x => set.add(x)),
            remove: (...c: string[]) => c.forEach(x => set.delete(x)),
            contains: (c: string) => set.has(c),
        },
        style: {} as CSSStyleDeclaration,
    };
    return el as unknown as HTMLElement & { classes: Set<string> };
}

describe('DropReveal', () => {
    it('reveals everything when no commit happened (cancel / click / no-op drag)', () => {
        const reveal = new DropReveal();
        const el = makeEl('task-card', 'is-dragging', 'is-drag-hidden');

        reveal.finish([el]);

        expect(el.classes.has('is-drag-hidden')).toBe(false);
        expect(el.classes.has('is-dragging')).toBe(false);
        expect(el.classes.has('task-card')).toBe(true);
    });

    it('reveals a source card whose committed geometry was applied', () => {
        const reveal = new DropReveal();
        const el = makeEl('is-drag-hidden');

        reveal.gate();
        reveal.markApplied(el);
        reveal.finish([el]);

        expect(el.classes.has('is-drag-hidden')).toBe(false);
    });

    it('keeps a committed-but-unapplied source card hidden for the next render', () => {
        const reveal = new DropReveal();
        const el = makeEl('is-dragging', 'is-drag-hidden');

        reveal.gate();
        reveal.finish([el]);

        // 旧ジオメトリのまま可視にすると 1 フレーム露出する → 隠したまま渡す
        expect(el.classes.has('is-drag-hidden')).toBe(true);
        expect(el.classes.has('is-dragging')).toBe(false);
    });

    it('converts a dimmed cross-view source to hidden rather than restoring it', () => {
        const reveal = new DropReveal();
        const el = makeEl('is-drag-source-dimmed');

        reveal.gate();
        reveal.finish([el]);

        expect(el.classes.has('is-drag-source-dimmed')).toBe(false);
        expect(el.classes.has('is-drag-hidden')).toBe(true);
    });

    it('never invents concealment for a card the gesture was not hiding', () => {
        // Grid の同一週 resize: ソースカードを直接動かすので hide も ghost も無い
        const reveal = new DropReveal();
        const el = makeEl('is-dragging');

        reveal.gate();
        reveal.finish([el]);

        expect(el.classes.has('is-drag-hidden')).toBe(false);
        expect(el.classes.has('is-dragging')).toBe(false);
    });

    it('is idempotent — dragEl is passed through both base and subclass cleanup', () => {
        const reveal = new DropReveal();
        const applied = makeEl('is-drag-hidden');
        const unapplied = makeEl('is-drag-hidden');

        reveal.gate();
        reveal.markApplied(applied);
        reveal.finish([applied, unapplied]);
        reveal.finish([applied, unapplied]);

        expect(applied.classes.has('is-drag-hidden')).toBe(false);
        expect(unapplied.classes.has('is-drag-hidden')).toBe(true);
    });

    it('isRevealable mirrors what finish will do', () => {
        const reveal = new DropReveal();
        const applied = makeEl('is-drag-hidden');
        const hidden = makeEl('is-drag-hidden');
        const plain = makeEl('is-dragging');

        expect(reveal.isRevealable(hidden)).toBe(true); // まだ gate されていない
        reveal.gate();
        reveal.markApplied(applied);

        expect(reveal.isRevealable(applied)).toBe(true);
        expect(reveal.isRevealable(hidden)).toBe(false);
        expect(reveal.isRevealable(plain)).toBe(true);
    });
});

// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'tv-inline:test.md:ln:1',
        file: 'test.md',
        line: 0,
        content: 'test',
        statusChar: ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        tags: [],
        originalText: '- [ ] test',
        parserId: 'tv-inline',
        startDate: '2026-08-12',
        startTime: '10:00',
        endDate: '2026-08-12',
        endTime: '11:00',
        ...overrides,
    };
}

/** commitAndReveal の順序だけを観測する最小の Strategy。 */
class OrderProbeStrategy extends BaseDragStrategy {
    name = 'OrderProbe';
    readonly log: string[] = [];

    onDown(): void { /* unused */ }
    onMove(): void { /* unused */ }
    async onUp(): Promise<void> { /* unused */ }

    async run(context: DragContext, plan: DragPlan | null, elements: HTMLElement[]): Promise<void> {
        await this.commitAndReveal({
            context,
            plan,
            taskId: 'tv-inline:test.md:ln:1',
            sourceElements: elements,
            applyGeometry: () => {
                this.log.push('applyGeometry');
                for (const el of elements) this.dropReveal.markApplied(el);
            },
            clearGhosts: () => this.log.push('clearGhosts'),
        });
    }
}

function makeContext(log: string[], onUpdate?: () => void): DragContext {
    return {
        plugin: { settings: { startHour: 5 } },
        writeService: {
            updateTask: async () => {
                log.push('commit');
                onUpdate?.();
                await Promise.resolve();
            },
        },
        onTaskClick: () => log.push('restoreSelection'),
    } as unknown as DragContext;
}

describe('BaseDragStrategy.commitAndReveal', () => {
    it('commits, applies the committed geometry, then reveals and drops the ghosts', async () => {
        const strategy = new OrderProbeStrategy();
        const context = makeContext(strategy.log);
        const el = makeEl('is-drag-hidden');
        const plan: DragPlan = {
            edits: { effectiveStartDate: '2026-08-13', effectiveStartTime: '10:00' },
            baseTask: makeTask(),
        };

        await strategy.run(context, plan, [el]);

        expect(strategy.log).toEqual(['commit', 'restoreSelection', 'applyGeometry', 'clearGhosts']);
        expect(el.classes.has('is-drag-hidden')).toBe(false);
    });

    it('leaves the source hidden while the write is in flight', async () => {
        const strategy = new OrderProbeStrategy();
        const el = makeEl('is-drag-hidden');
        let hiddenDuringWrite: boolean | null = null;
        const context = makeContext(strategy.log, () => {
            hiddenDuringWrite = el.classes.has('is-drag-hidden');
        });

        await strategy.run(context, {
            edits: { effectiveStartDate: '2026-08-13', effectiveStartTime: '10:00' },
            baseTask: makeTask(),
        }, [el]);

        // write の往復中に可視へ戻ると、その間ずっと旧位置が見える
        expect(hiddenDuringWrite).toBe(true);
    });

    it('reveals without gating when the drag produced no write', async () => {
        const strategy = new OrderProbeStrategy();
        const context = makeContext(strategy.log);
        const el = makeEl('is-drag-hidden');

        // 掴んだだけで値が変わっていない → updateTask は呼ばれない
        await strategy.run(context, {
            edits: { effectiveStartDate: '2026-08-12', effectiveStartTime: '10:00' },
            baseTask: makeTask(),
        }, [el]);

        expect(strategy.log).toEqual(['clearGhosts']);
        // 旧ジオメトリがそのまま正しいので、隠したままにしてはいけない
        expect(el.classes.has('is-drag-hidden')).toBe(false);
    });
});
