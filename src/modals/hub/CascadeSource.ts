import { App, TFile } from 'obsidian';
import type { Task, TvFileKeys } from '../../types';
import { FilePropertyResolver } from '../../services/parsing/FilePropertyResolver';
import type { ExtractedProperties } from '../../services/parsing/tree/BuiltinPropertyExtractor';

export type CascadeSourceKind = 'file' | 'section';

/**
 * cascade 値の出所（file frontmatter か section property block か）を導出する。
 *
 * cascadeContext は値のみで出所メタデータを持たない（保存しない方針）。
 * file 層の寄与は FilePropertyResolver.extract（純関数）を metadataCache の
 * frontmatter に適用すれば再現できるので、cascade 値と比較して一致すれば
 * file 由来、不一致（= section が上書き / 追加）なら section 由来と判定する。
 * 見出し単位の特定はしない（ユーザー決定: file / section の粗い区別で十分）。
 */
export class CascadeSource {
    static fileLayer(app: App, task: Task, keys: TvFileKeys): ExtractedProperties {
        const file = app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return { properties: {} };
        return FilePropertyResolver.extract(app.metadataCache.getFileCache(file)?.frontmatter, keys);
    }

    /** color / linestyle / mask の cascade 出所。cascade 値がなければ null */
    static forStyleField(
        app: App, task: Task, keys: TvFileKeys,
        field: 'color' | 'linestyle' | 'mask',
    ): CascadeSourceKind | null {
        const cascadeValue = task.cascadeContext?.[field];
        if (cascadeValue === undefined || task[field] !== undefined) return null;
        return this.fileLayer(app, task, keys)[field] === cascadeValue ? 'file' : 'section';
    }

    /** cascade 由来タグ 1 件の出所 */
    static forTag(app: App, task: Task, keys: TvFileKeys, tag: string): CascadeSourceKind {
        const fileTags = this.fileLayer(app, task, keys).tags ?? [];
        return fileTags.includes(tag) ? 'file' : 'section';
    }

    /** cascade 由来カスタムプロパティ 1 件の出所 */
    static forProperty(app: App, task: Task, keys: TvFileKeys, key: string, value: string): CascadeSourceKind {
        const fileProps = this.fileLayer(app, task, keys).properties;
        return fileProps[key]?.value === value ? 'file' : 'section';
    }
}
