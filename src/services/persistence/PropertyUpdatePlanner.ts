import type { PropertyValue, ScopeKeys, Task } from '../../types';
import { TagExtractor } from '../parsing/utils/TagExtractor';
import { PropertyKey } from '../parsing/utils/PropertyKey';
import { reservedPropertyKeys } from '../parsing/utils/FrontmatterPolicy';
import { logWarn } from '../../log/log';

/**
 * What a property's own lines are to say once written:
 *
 * - `text`: one line's value, as spelled (`- key:: 007`). Its type is the
 *   one the line reads it as (`PropertyValues.fromText`): the spelling says
 *   it, and nothing is added to it here
 * - `items`: a list, each item's spelling in order, written as the items
 *   under a line with no value (`- key::` and `- a` under it)
 * - `tags`: tags, without their `#`, written as `#a #b` on the line, or as
 *   one `- #a` item each under a line that writes them as a list
 */
export type PropertyWrite =
    | { text: string }
    | { items: readonly string[] }
    | { tags: readonly string[] };

/**
 * One write to a task's own lines of the property `key`, its case aside
 * (`PropertyKey`): the key a built-in is written under (`tv-color` as the
 * settings name it, `tags`), or a custom one's. The writer finds the line by
 * the key, keeps its key as written, and spells a new line's key so.
 *
 * - `set`: the property's lines say `value`
 * - `hide`: the property's line says no value (`- key::`, nothing under
 *   it), which hides the value above it
 * - `delete`: the property's line and the items under it are taken out, so
 *   the value above comes through
 */
export type PropertyOp =
    | { key: string; op: 'set'; value: PropertyWrite }
    | { key: string; op: 'hide' }
    | { key: string; op: 'delete' };

/**
 * The property ops of one write, and the keys that tell a built-in's lines
 * from a custom one's: the writer reads the task's property lines as the
 * parser does (`PropertyLines.read`), to write over none it finds wrong.
 */
export interface PropertyEdit {
    ops: readonly PropertyOp[];
    keys: ScopeKeys;
}

/**
 * updates（宣言的差分）→ PropertyOp[]（正規化された操作列）の純関数変換。
 *
 * updates の契約:
 * - キー不在 = 変更なし（op を出さない）
 * - 色、線種、マスク: 文字 = set、null = hide、undefined か空文字 = delete
 * - タグ: own tags 全体の望ましい姿。本文の `#tag` を除いた残りを set、
 *   残りが無ければ delete（`- tags::` は何も足さず、隠しもしない）
 * - カスタムプロパティ: own record の望ましい全体像。キーごとに、値なし
 *   （綴りが空の null）は hide、項目のあるリストは項目の set、ほかの値は
 *   綴りの set、record に無いキーは delete。前と同じ綴りのキーは op を出さない
 *
 * 受け継いだ値と同じ値でも、own の行が無ければ set になる（own と比べる）。
 */
export class PropertyUpdatePlanner {
    static plan(before: Task, updates: Partial<Task>, keys: ScopeKeys): PropertyOp[] {
        const ops: PropertyOp[] = [];

        for (const field of ['color', 'linestyle', 'mask'] as const) {
            if (!(field in updates)) continue;
            const raw = updates[field];
            const value = raw?.trim();
            if (raw === null) ops.push({ key: keys[field], op: 'hide' });
            else if (value) ops.push({ key: keys[field], op: 'set', value: { text: value } });
            else ops.push({ key: keys[field], op: 'delete' });
        }

        if ('tags' in updates) {
            // updates.tags は own tags 全体（content 由来含む、Task.tags と同義）。
            // content 内 #tag は content 自身が宣言なので、property 宣言
            // （子行 / frontmatter）に書くべき残余だけを導出する。
            const wanted = updates.tags ?? [];
            const content = ('content' in updates ? updates.content : before.content) ?? '';
            const contentTags = new Set(TagExtractor.fromContent(content));
            const declTags = TagExtractor.merge(wanted.filter(t => !contentTags.has(t)));
            if (declTags.length > 0) {
                ops.push({ key: 'tags', op: 'set', value: { tags: declTags } });
            } else {
                ops.push({ key: 'tags', op: 'delete' });
            }
        }

        if ('properties' in updates) {
            // キーは折りたたんだ形で突き合わせる。
            const after = updates.properties ?? {};
            const beforeProps = before.properties ?? {};
            const reserved = reservedPropertyKeys(keys);

            for (const { key, value } of Object.values(after)) {
                if (reserved.has(PropertyKey.fold(key))) {
                    logWarn(`[PropertyUpdatePlanner] custom key "${key}" collides with a reserved key — skipped`);
                    continue;
                }
                const was = PropertyKey.get(beforeProps, key);
                if (!was || !PropertyUpdatePlanner.sameWritten(was.value, value)) ops.push(PropertyUpdatePlanner.opOf(key, value));
            }
            for (const { key } of Object.values(beforeProps)) {
                if (reserved.has(PropertyKey.fold(key))) continue;
                if (!PropertyKey.get(after, key)) ops.push({ key, op: 'delete' });
            }
        }

        return ops;
    }

    /**
     * The op that writes `value` as the property `key`'s own: no value with
     * nothing spelled hides (`- key::`), a list with items is its items, and
     * any other value is its spelling (`null` and `~` too, as typed). A list
     * of none is no line can write (`key: []`), and takes the line out.
     */
    static opOf(key: string, value: PropertyValue): PropertyOp {
        if (value.type === 'null' && value.spelling === '') return { key, op: 'hide' };
        if (value.type === 'list') {
            return value.items.length > 0
                ? { key, op: 'set', value: { items: value.items.map(item => item.spelling) } }
                : { key, op: 'delete' };
        }
        return { key, op: 'set', value: { text: value.spelling } };
    }

    /** Whether `a` and `b` are written alike: one type, and one spelling, item by item for a list. */
    static sameWritten(a: PropertyValue, b: PropertyValue): boolean {
        if (a.type === 'list' || b.type === 'list') {
            return a.type === 'list' && b.type === 'list'
                && a.items.length === b.items.length
                && a.items.every((item, i) => item.spelling === b.items[i].spelling);
        }
        return a.type === b.type && a.spelling === b.spelling;
    }
}
