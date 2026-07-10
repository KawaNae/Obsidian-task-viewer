import type { PropertyValue, Task } from '../../types';

/**
 * フォームのフィールド確定値 → updateTask に渡す Partial<Task> 差分。
 *
 * updates セマンティクス（PropertyUpdatePlanner と同じ契約）:
 * - 変更なし → null（updateTask を呼ばない）
 * - 値あり → own 宣言を設定
 * - undefined → own 宣言の削除（暗黙値 / cascade が透ける）
 *
 * 旧「プロパティ変更」フォーム（CreateTaskModal 流用）にあった
 * 「tvFile は空欄→暗黙値で充填して常に書く」は、フィールド単位コミット
 * では不要になったため廃止 — 空欄は一貫して「宣言なし」を意味する。
 */
export class TaskUpdateBuilder {
    static content(task: Task, content: string): Partial<Task> | null {
        return content === task.content ? null : { content };
    }

    static status(task: Task, statusChar: string): Partial<Task> | null {
        return statusChar === task.statusChar ? null : { statusChar };
    }

    static dateGroup(task: Task, group: 'start' | 'end', date: string, time: string): Partial<Task> | null {
        const d = date.trim() || undefined;
        const tm = time.trim() || undefined;
        if (group === 'start') {
            if (task.startDate === d && task.startTime === tm) return null;
            return { startDate: d, startTime: tm };
        }
        if (task.endDate === d && task.endTime === tm) return null;
        return { endDate: d, endTime: tm };
    }

    static due(task: Task, date: string, time: string): Partial<Task> | null {
        const d = date.trim();
        const tm = time.trim();
        const due = d ? (tm ? `${d}T${tm}` : d) : undefined;
        return due === task.due ? null : { due };
    }

    static styleField(task: Task, field: 'color' | 'linestyle' | 'mask', value: string): Partial<Task> | null {
        const v = value.trim() || undefined;
        return task[field] === v ? null : { [field]: v };
    }

    /** own tags 全体（content 由来含む）の望ましい姿を渡す */
    static tags(task: Task, tags: string[]): Partial<Task> | null {
        const next = [...new Set(tags)].sort();
        const prev = [...new Set(task.tags)].sort();
        if (next.length === prev.length && next.every((t, i) => t === prev[i])) return null;
        return { tags: next };
    }

    /** own custom properties 全体の望ましい姿を渡す（per-key diff は planner が行う） */
    static customProperties(task: Task, props: Record<string, PropertyValue>): Partial<Task> | null {
        const prev = task.properties ?? {};
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(props);
        const same = prevKeys.length === nextKeys.length
            && nextKeys.every(k => prev[k]?.value === props[k].value);
        return same ? null : { properties: props };
    }
}
