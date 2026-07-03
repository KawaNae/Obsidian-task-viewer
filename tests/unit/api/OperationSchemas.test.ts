import { describe, it, expect } from 'vitest';
import {
    assertParams, suggestKey,
    LIST_SCHEMA, GET_SCHEMA, CREATE_SCHEMA,
    TASKS_FOR_DATE_RANGE_SCHEMA,
} from '../../../src/api/OperationSchemas';
import { TaskApiError } from '../../../src/api/TaskApiTypes';

describe('assertParams', () => {
    it('未知キーは TaskApiError（did-you-mean 付き）', () => {
        expect(() => assertParams({ statuss: 'x' }, LIST_SCHEMA, 'list'))
            .toThrowError(/Unknown parameter for list: statuss.*Did you mean: status\?/);
    });

    it('候補が見つからない未知キーは Available 一覧を出す', () => {
        expect(() => assertParams({ zzzzzz: '1' }, LIST_SCHEMA, 'list'))
            .toThrowError(/Unknown parameter for list: zzzzzz.*Available: file, status/);
    });

    it('required 欠落は既存互換メッセージ', () => {
        expect(() => assertParams({}, GET_SCHEMA, 'get'))
            .toThrowError('Missing required parameter: id');
        expect(() => assertParams({ content: 'x' }, CREATE_SCHEMA, 'create'))
            .toThrowError('Missing required parameter: file');
    });

    it('空文字列は required 欠落として扱う', () => {
        expect(() => assertParams({ id: '' }, GET_SCHEMA, 'get'))
            .toThrowError('Missing required parameter: id');
    });

    it('未知キーが required 欠落より先に報告される', () => {
        expect(() => assertParams({ di: 'task-1' }, GET_SCHEMA, 'get'))
            .toThrowError(/Unknown parameter for get: di/);
    });

    it('正しいパラメータは通過する', () => {
        expect(() => assertParams({ id: 'task-1' }, GET_SCHEMA, 'get')).not.toThrow();
        expect(() => assertParams({}, LIST_SCHEMA, 'list')).not.toThrow();
        expect(() => assertParams(
            { start: '2026-03-01', end: '2026-03-31', limit: 5 },
            TASKS_FOR_DATE_RANGE_SCHEMA, 'tasksForDateRange',
        )).not.toThrow();
    });

    it('throw されるのは TaskApiError 型', () => {
        try {
            assertParams({ bogus: '1' }, LIST_SCHEMA, 'list');
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(TaskApiError);
        }
    });
});

describe('suggestKey', () => {
    const keys = Object.keys(LIST_SCHEMA);

    it('1 文字の typo を当てる', () => {
        expect(suggestKey('statuss', keys)).toBe('status');
        expect(suggestKey('fil', keys)).toBe('file');
    });

    it('転置を当てる', () => {
        expect(suggestKey('ifle', keys)).toBe('file');
    });

    it('短いキーは距離 1 に絞って誤爆を防ぐ', () => {
        // 'xx' は 'to' と距離 2 だが、短キーなので候補にしない
        expect(suggestKey('xx', keys)).toBe(null);
    });

    it('遠い入力は null', () => {
        expect(suggestKey('zzzzzz', keys)).toBe(null);
    });

    it('前方一致フォールバック', () => {
        expect(suggestKey('cont', keys)).toBe('content');
    });
});

describe('schema 整合性', () => {
    const ALL = {
        LIST_SCHEMA, GET_SCHEMA, CREATE_SCHEMA, TASKS_FOR_DATE_RANGE_SCHEMA,
    } as const;

    it('全 spec は boolean / hidden / value のいずれかを持つ', () => {
        for (const [name, schema] of Object.entries(ALL)) {
            for (const [key, spec] of Object.entries(schema)) {
                const ok = spec.boolean === true || spec.cli === 'hidden' || typeof spec.value === 'string';
                expect(ok, `${name}.${key}`).toBe(true);
            }
        }
    });
});
