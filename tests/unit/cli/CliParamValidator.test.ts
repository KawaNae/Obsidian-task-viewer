import { describe, it, expect } from 'vitest';
import { validateCliParams } from '../../../src/cli/CliParamValidator';
import { toCliFlags, toCliName, LIST_SCHEMA, DUPLICATE_SCHEMA, INSERT_CHILD_TASK_SCHEMA } from '../../../src/api/OperationSchemas';

const LIST_FLAGS = toCliFlags(LIST_SCHEMA, { output: true });

function errorOf(result: string | null): string {
    expect(result).not.toBe(null);
    return (JSON.parse(result!) as { error: string }).error;
}

describe('validateCliParams', () => {
    it('宣言済みフラグは通過する', () => {
        expect(validateCliParams({ status: 'x', limit: '5' }, LIST_FLAGS, 'list')).toBe(null);
        expect(validateCliParams({ 'output-fields': 'content', format: 'tsv' }, LIST_FLAGS, 'list')).toBe(null);
        expect(validateCliParams({}, LIST_FLAGS, 'list')).toBe(null);
    });

    it('未知フラグは did-you-mean 付きエラー', () => {
        const err = errorOf(validateCliParams({ statuss: 'x' }, LIST_FLAGS, 'list'));
        expect(err).toMatch(/Unknown flag: statuss/);
        expect(err).toMatch(/Did you mean: status\?/);
    });

    it('候補なしの未知フラグは Available flags を列挙', () => {
        const err = errorOf(validateCliParams({ zzzzz: '1' }, LIST_FLAGS, 'list'));
        expect(err).toMatch(/Unknown flag: zzzzz/);
        expect(err).toMatch(/Available flags: file, status/);
    });

    it('boolean フラグへの値付与はエラー', () => {
        const err = errorOf(validateCliParams({ leaf: '1' }, LIST_FLAGS, 'list'));
        expect(err).toMatch(/boolean flag/);
        // bare flag（Obsidian は 'true' を渡す）は通過
        expect(validateCliParams({ leaf: 'true' }, LIST_FLAGS, 'list')).toBe(null);
    });

    it('flags なしコマンドは全引数を拒否する', () => {
        const err = errorOf(validateCliParams({ anything: 'x' }, null, 'get-start-hour'));
        expect(err).toMatch(/Unknown flag: anything/);
        expect(err).toMatch(/takes no flags/);
        expect(validateCliParams({}, null, 'get-start-hour')).toBe(null);
    });

    it('kebab 変換後のフラグ名で検証する（day-offset / parent-id）', () => {
        const dupFlags = toCliFlags(DUPLICATE_SCHEMA);
        expect(validateCliParams({ id: 't', 'day-offset': '1' }, dupFlags, 'duplicate')).toBe(null);
        expect(errorOf(validateCliParams({ id: 't', dayOffset: '1' }, dupFlags, 'duplicate')))
            .toMatch(/Unknown flag: dayOffset.*Did you mean: day-offset\?/);

        const childFlags = toCliFlags(INSERT_CHILD_TASK_SCHEMA);
        expect(validateCliParams({ 'parent-id': 't', content: 'c' }, childFlags, 'insert-child-task')).toBe(null);
    });
});

describe('toCliName / toCliFlags', () => {
    it('camelCase → kebab-case の機械的双射', () => {
        expect(toCliName('outputFields')).toBe('output-fields');
        expect(toCliName('filterFile')).toBe('filter-file');
        expect(toCliName('parentId')).toBe('parent-id');
        expect(toCliName('dayOffset')).toBe('day-offset');
        expect(toCliName('status')).toBe('status');
    });

    it('hidden パラメータは CLI に露出しない', () => {
        expect('filter' in LIST_FLAGS).toBe(false);
    });

    it('boolean は value を持たず、required は透過する', () => {
        expect(LIST_FLAGS.leaf.value).toBeUndefined();
        expect(LIST_FLAGS.root.value).toBeUndefined();
        const dup = toCliFlags(DUPLICATE_SCHEMA);
        expect(dup.id.required).toBe(true);
        expect(dup['day-offset'].required).toBeUndefined();
    });

    it('output オプションで format / output-fields が合成される', () => {
        expect(LIST_FLAGS.format).toBeDefined();
        expect(LIST_FLAGS['output-fields']).toBeDefined();
        expect(toCliFlags(DUPLICATE_SCHEMA).format).toBeUndefined();
    });
});
