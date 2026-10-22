import type { Task } from '../../types';
import type { ValueSource } from '../../services/parsing/tree/Sections';
import { PropertyKey } from '../../services/parsing/utils/PropertyKey';
import type { LineTarget } from './SourceLine';

export type CascadeSourceKind = 'file' | 'section';

/**
 * cascade 値の出所（file frontmatter か section property block か）。
 *
 * 出所は解決が値と一緒に記録したもの（`SectionNode.resolvedSources`、タスクには
 * `inheritedFrom` として載る）をそのまま言い直す。値を決めた層を決めるのは
 * 解決だけであり、ここで層をたどり直したり metadataCache の frontmatter を
 * 読み直したりしない。キャッシュはタスクを読んだ版より古いことがあり、
 * 読み直せば別の版の出所を言うことになる（structure の「読みの鮮度」）。
 * 見出し単位の特定はしない（file / section の粗い区別で十分）。frontmatter と
 * 根（最初の見出しより上のプロパティ行、ノート全体に届く）は、どちらもノートの値
 * なので file と言う。どちらの行かは、ラベルから行を開けば分かる。
 */
export class CascadeSource {
    /**
     * color / linestyle / mask の cascade 出所。受け継いだ値なし（上の層が
     * `- tv-color::` で隠した値）も、値と同じく隠した層を出所として言う。
     * 何も受け継がない、または自身の値（値なしを含む）があれば null
     */
    static forStyleField(task: Task, field: 'color' | 'linestyle' | 'mask'): CascadeSourceKind | null {
        if (task[field] !== undefined) return null;
        const from = task.inheritedFrom?.fields[field];
        if (task.cascadeContext?.[field] === undefined && !from) return null;
        return kindOf(from);
    }

    /** cascade 由来タグ 1 件の出所: そのタグを最初に加えた層 */
    static forTag(task: Task, tag: string): CascadeSourceKind {
        return kindOf(task.inheritedFrom?.tags.find(layer => layer.tags.includes(tag))?.from);
    }

    /** cascade 由来カスタムプロパティ 1 件の出所。キーは大文字と小文字を区別しない */
    static forProperty(task: Task, key: string): CascadeSourceKind {
        return kindOf(task.inheritedFrom?.properties[PropertyKey.fold(key)]);
    }

    /**
     * The line an inherited style value is written on (`frontmatterKey` the
     * key the settings name for it), to open in the editor; null when no
     * layer is recorded for it.
     */
    static lineOfStyleField(task: Task, field: 'color' | 'linestyle' | 'mask', frontmatterKey: string): LineTarget | null {
        return targetOf(task.inheritedFrom?.fields[field], frontmatterKey);
    }

    /** The line of the layer that first adds the inherited tag `tag`. */
    static lineOfTag(task: Task, tag: string): LineTarget | null {
        return targetOf(task.inheritedFrom?.tags.find(layer => layer.tags.includes(tag))?.from, 'tags');
    }

    /** The line an inherited custom property is written on, its key's case aside. */
    static lineOfProperty(task: Task, key: string): LineTarget | null {
        return targetOf(task.inheritedFrom?.properties[PropertyKey.fold(key)], key);
    }
}

/** A layer's line as the hub opens it: a frontmatter key by its key too, which the Properties view shows; a property line, the root's too, by its line. */
function targetOf(source: ValueSource | undefined, key: string): LineTarget | null {
    if (!source) return null;
    return source.kind === 'frontmatter' ? { line: source.line, frontmatterKey: key } : { line: source.line };
}

/**
 * frontmatter と根の行はノートの値、見出しのセクションの行は節の値。記録がない値は
 * 節の値として言う（記録はすべての継承値にあるので、起きるのは記録を持たないタスクだけ）。
 */
function kindOf(source: ValueSource | undefined): CascadeSourceKind {
    if (!source) return 'section';
    return source.kind === 'frontmatter' || source.heading === null ? 'file' : 'section';
}
