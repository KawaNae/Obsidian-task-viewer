import { describe, it, expect } from 'vitest';
import { ChildPropertyLineEditor } from '../../../src/services/persistence/utils/ChildPropertyLineEditor';

describe('ChildPropertyLineEditor', () => {
    describe('findOwnPropertyLines', () => {
        it('空値プロパティ行 (`- key ::`) を own として検出する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - key ::',
                '    - key2 :: value2',
            ];
            const own = ChildPropertyLineEditor.findOwnPropertyLines(lines, 0);
            expect(own).toEqual([
                { lineIdx: 1, key: 'key', value: '' },
                { lineIdx: 2, key: 'key2', value: 'value2' },
            ]);
        });
    });

    describe('applyOps: set', () => {
        it('空値行への値設定はセパレータ空白を補ってその場更新する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - key ::',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key', op: 'set', value: 'v1' }]);
            expect(lines[1]).toBe('    - key :: v1');
        });

        it('既存値の置換はプレフィックス（インデント・キー表記）を保存する', () => {
            const lines = [
                '- [ ] task',
                '\t- 金額:: 100',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: '金額', op: 'set', value: '200' }]);
            expect(lines[1]).toBe('\t- 金額:: 200');
        });

        it('値を空に設定すると空値プロパティ行として残る', () => {
            const lines = [
                '- [ ] task',
                '    - key:: v1',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key', op: 'set', value: '' }]);
            expect(lines[1]).toBe('    - key:: ');
        });
    });

    describe('applyOps: insert (own プロパティ行なし)', () => {
        it('既存子行のインデント表現を踏襲する（スペース系ファイルで tab 混在させない）', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '    - [ ] sub',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key2', op: 'set', value: 'value2' }]);
            expect(lines).toEqual([
                '- [ ] task @2026-07-18T10:00',
                '    - key2:: value2',
                '    - [ ] sub',
            ]);
        });

        it('子行が無い場合はタスク行インデント + タブ 1 で挿入する', () => {
            const lines = [
                '- [ ] task @2026-07-18T10:00',
                '',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key2', op: 'set', value: 'value2' }]);
            expect(lines[1]).toBe('\t- key2:: value2');
        });

        it('own プロパティ行があればその直後・同インデントに挿入する', () => {
            const lines = [
                '- [ ] task',
                '    - key ::',
                '    - [ ] sub',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key2', op: 'set', value: 'v2' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    - key ::',
                '    - key2:: v2',
                '    - [ ] sub',
            ]);
        });
    });

    describe('applyOps: delete', () => {
        it('空値プロパティ行も delete で除去できる', () => {
            const lines = [
                '- [ ] task',
                '    - key ::',
                '    - [ ] sub',
            ];
            ChildPropertyLineEditor.applyOps(lines, 0, [{ key: 'key', op: 'delete' }]);
            expect(lines).toEqual([
                '- [ ] task',
                '    - [ ] sub',
            ]);
        });
    });
});
