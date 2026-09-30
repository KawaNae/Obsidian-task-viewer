import { describe, it, expect } from 'vitest';
import { TaskStore } from '../../../../src/services/core/TaskStore';
import { makeTask } from '../../helpers/makeTask';

describe('TaskStore の錨の表', () => {
    const row = (id: string, file: string, anchor?: string) => makeTask({ id, file, anchor });

    it('錨から、その錨を持つ行を引く', () => {
        const store = new TaskStore();
        store.setTask('a1', row('a1', 'a.md', 'x'));
        store.setTask('a2', row('a2', 'a.md'));
        store.setTask('b1', row('b1', 'b.md', 'x'));
        expect(store.getTaskByAnchor('a.md', 'x')?.id).toBe('a1');
        expect(store.getTaskByAnchor('b.md', 'x')?.id).toBe('b1');
        expect(store.getTaskByAnchor('a.md', 'y')).toBeUndefined();
        expect(store.getTaskByAnchor('c.md', 'x')).toBeUndefined();
    });

    it('ファイルの行を除くと、その錨も引けなくなる', () => {
        const store = new TaskStore();
        store.setTask('a1', row('a1', 'a.md', 'x'));
        store.setTask('b1', row('b1', 'b.md', 'x'));
        store.removeTasksByFile('a.md');
        expect(store.getTaskByAnchor('a.md', 'x')).toBeUndefined();
        expect(store.getTaskByAnchor('b.md', 'x')?.id).toBe('b1');
    });

    it('次の読みの名前で入れ直した行を引く', () => {
        const store = new TaskStore();
        store.setTask('n1', row('n1', 'a.md', 'x'));
        store.removeTasksByFile('a.md');
        store.setTask('n2', row('n2', 'a.md', 'x'));
        expect(store.getTaskByAnchor('a.md', 'x')?.id).toBe('n2');
    });

    it('同じ名前で錨の無い行に置き換えると、錨は引けない', () => {
        const store = new TaskStore();
        store.setTask('a1', row('a1', 'a.md', 'x'));
        store.setTask('a1', row('a1', 'a.md'));
        expect(store.getTaskByAnchor('a.md', 'x')).toBeUndefined();
    });

    it('行を消すか、すべてを消すと引けない', () => {
        const store = new TaskStore();
        store.setTask('a1', row('a1', 'a.md', 'x'));
        store.setTask('b1', row('b1', 'b.md', 'y'));
        store.deleteTask('a1');
        expect(store.getTaskByAnchor('a.md', 'x')).toBeUndefined();
        store.clear();
        expect(store.getTaskByAnchor('b.md', 'y')).toBeUndefined();
    });
});
