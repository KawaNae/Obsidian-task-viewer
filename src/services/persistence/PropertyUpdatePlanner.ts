import type { Task, ScopeKeys } from '../../types';
import { TagExtractor } from '../parsing/utils/TagExtractor';
import { PropertyKey } from '../parsing/utils/PropertyKey';
import { PropertyValues } from '../parsing/utils/PropertyValues';
import { reservedPropertyKeys } from '../parsing/utils/FrontmatterPolicy';
import { logWarn } from '../../log/log';

/**
 * 非時刻プロパティ（color/linestyle/mask/tags/custom）の書き込み操作。
 * `key` は物理的な宣言キー（tv-color 等の設定キー名 / リテラル 'tags' /
 * カスタムキー名）に解決済み。writer は既存の行を大文字と小文字を区別せずに
 * このキーで探し（`PropertyKey`）、行を新しく足すときだけこの綴りで書く。
 */
export interface PropertyOp {
    key: string;
    op: 'set' | 'delete';
    /** set のみ。tags は string[]（# なし）、その他は文字列値 */
    value?: string | string[];
}

/**
 * updates（宣言的差分）→ PropertyOp[]（正規化された操作列）の純関数変換。
 *
 * updates セマンティクスの契約:
 * - キー不在        = 変更なし（op を出さない）
 * - キーあり・値あり = own 宣言を設定
 * - キーあり・undefined / 空文字 = own 宣言の削除（cascade 値が透ける）
 *
 * ルールA（新規は正準位置）とルールC（継承は上書きのみ）の「どこに何を
 * 書くべきか」の決定はここで完結し、writer はルールB（既存宣言の表現保持）
 * だけを担う。
 */
export class PropertyUpdatePlanner {
    static plan(before: Task, updates: Partial<Task>, keys: ScopeKeys): PropertyOp[] {
        const ops: PropertyOp[] = [];

        for (const field of ['color', 'linestyle', 'mask'] as const) {
            if (!(field in updates)) continue;
            const value = updates[field]?.trim();
            if (value) {
                ops.push({ key: keys[field], op: 'set', value });
            } else {
                ops.push({ key: keys[field], op: 'delete' });
            }
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
                ops.push({ key: 'tags', op: 'set', value: declTags });
            } else {
                ops.push({ key: 'tags', op: 'delete' });
            }
        }

        if ('properties' in updates) {
            // updates.properties は own record の望ましい全体像。per-key diff で
            // set / delete に分解する。キーは折りたたんだ形で突き合わせる。
            const after = updates.properties ?? {};
            const beforeProps = before.properties ?? {};
            const reserved = reservedPropertyKeys(keys);

            for (const { key, value } of Object.values(after)) {
                if (reserved.has(PropertyKey.fold(key))) {
                    logWarn(`[PropertyUpdatePlanner] custom key "${key}" collides with a reserved key — skipped`);
                    continue;
                }
                const spelling = PropertyValues.spelling(value);
                const was = PropertyKey.get(beforeProps, key);
                if (!was || PropertyValues.spelling(was.value) !== spelling) {
                    ops.push({ key, op: 'set', value: spelling });
                }
            }
            for (const { key } of Object.values(beforeProps)) {
                if (reserved.has(PropertyKey.fold(key))) continue;
                if (!PropertyKey.get(after, key)) ops.push({ key, op: 'delete' });
            }
        }

        return ops;
    }
}
