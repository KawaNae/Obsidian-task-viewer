import type { Task } from '../../types';
import type { ValueSource } from '../../services/parsing/tree/Sections';
import { PropertyKey } from '../../services/parsing/utils/PropertyKey';

export type CascadeSourceKind = 'file' | 'section';

/**
 * cascade 値の出所（file frontmatter か section property block か）。
 *
 * 出所は解決が値と一緒に記録したもの（`SectionNode.resolvedSources`、タスクには
 * `inheritedFrom` として載る）をそのまま言い直す。値を決めた層を決めるのは
 * 解決だけであり、ここで層をたどり直したり metadataCache の frontmatter を
 * 読み直したりしない。キャッシュはタスクを読んだ版より古いことがあり、
 * 読み直せば別の版の出所を言うことになる（structure の「読みの鮮度」）。
 * 見出し単位の特定はしない（ユーザー決定: file / section の粗い区別で十分）。
 */
export class CascadeSource {
    /** color / linestyle / mask の cascade 出所。cascade 値がない、または自身の値があれば null */
    static forStyleField(task: Task, field: 'color' | 'linestyle' | 'mask'): CascadeSourceKind | null {
        if (task.cascadeContext?.[field] === undefined || task[field] !== undefined) return null;
        return kindOf(task.inheritedFrom?.fields[field]);
    }

    /** cascade 由来タグ 1 件の出所: そのタグを最初に加えた層 */
    static forTag(task: Task, tag: string): CascadeSourceKind {
        return kindOf(task.inheritedFrom?.tags.find(layer => layer.tags.includes(tag))?.from);
    }

    /** cascade 由来カスタムプロパティ 1 件の出所。キーは大文字と小文字を区別しない */
    static forProperty(task: Task, key: string): CascadeSourceKind {
        return kindOf(task.inheritedFrom?.properties[PropertyKey.fold(key)]);
    }
}

/** 記録がない値は節の値として言う（記録はすべての継承値にあるので、起きるのは記録を持たないタスクだけ）。 */
function kindOf(source: ValueSource | undefined): CascadeSourceKind {
    return source?.kind === 'frontmatter' ? 'file' : 'section';
}
