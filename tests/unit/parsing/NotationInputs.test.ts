import { describe, it, expect } from 'vitest';
import { notationInName, TaskContentInput } from '../../../src/services/parsing/tv-inline/TaskContentInput';
import { TagInput } from '../../../src/services/parsing/utils/TagInput';
import { PropertyKeyInput, ScopeKeyInput } from '../../../src/services/parsing/utils/PropertyKeyInput';
import { StatusCharInput } from '../../../src/services/parsing/utils/StatusCharInput';
import { HeadingInput } from '../../../src/services/parsing/utils/HeadingInput';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';

describe('a task name typed in a field (入力の論点 A)', () => {
    it.each([
        ['電話 @10:00', 'dateBlock'],
        ['電話 @2026-10-05', 'dateBlock'],
        ['電話 @>2026-10-05', 'dateBlock'],
        ['電話 ==> next', 'command'],
        ['電話 ^abc', 'blockId'],
    ] as const)('refuses %j, which the line reads as %s', (text, kind) => {
        expect(notationInName(text)).toBe(kind);
        expect(TaskContentInput.read(text)).toEqual({ ok: false, issue: { code: 'notation', kind } });
    });

    it.each(['電話 @alice', '会議 @1on1', 'a ==>', '#仕事 [[ノート]] を書く', '', 'x^abc'])('takes %j as its own text', (text) => {
        expect(notationInName(text)).toBeNull();
        expect(TaskContentInput.read(text)).toEqual({ ok: true, value: text });
    });
});

describe('tags typed to add', () => {
    it('reads words parted by space, with or without #', () => {
        expect(TagInput.read('#仕事  急ぎ')).toEqual({ ok: true, value: ['仕事', '急ぎ'] });
        expect(TagInput.show(['仕事', '急ぎ'])).toBe('#仕事 #急ぎ');
    });

    it('refuses a word the notation would not read back as one tag, with the characters that break it', () => {
        expect(TagInput.read('a#b')).toEqual({ ok: false, issue: { code: 'chars', chars: '#' } });
        expect(TagInput.read('a,b c')).toEqual({ ok: false, issue: { code: 'chars', chars: ',' } });
        expect(TagInput.read(' ')).toEqual({ ok: false, issue: { code: 'empty' } });
    });
});

describe('a property key typed to add', () => {
    const keys = PropertyKeyInput.of(DEFAULT_SCOPE_KEYS);

    it('reads a key with the space around it taken off', () => {
        expect(keys.read('  場所 ')).toEqual({ ok: true, value: '場所' });
    });

    it('refuses what the property line would not read as the key', () => {
        expect(keys.read('a:b')).toEqual({ ok: false, issue: { code: 'chars', chars: ':' } });
        expect(keys.read('[a]')).toEqual({ ok: false, issue: { code: 'chars', chars: '[ ]' } });
    });

    it('refuses a key the plugin keeps for itself', () => {
        expect(keys.read('tv-start')).toEqual({ ok: false, issue: { code: 'reserved' } });
        expect(keys.read('tags')).toEqual({ ok: false, issue: { code: 'reserved' } });
    });
});

describe('a scope key typed in the settings', () => {
    const others = ['tv-end', 'tv-due'];

    it('reads a key with the space around it taken off', () => {
        expect(ScopeKeyInput.read('  my-start ', others)).toEqual({ ok: true, value: 'my-start' });
    });

    it('refuses an empty key, and one the property line would not read as the key', () => {
        expect(ScopeKeyInput.read('  ', others)).toEqual({ ok: false, issue: { code: 'empty' } });
        expect(ScopeKeyInput.read('tv:start', others)).toEqual({ ok: false, issue: { code: 'chars', chars: ':' } });
    });

    it('refuses a key reserved apart from the scope keys, and another scope key', () => {
        expect(ScopeKeyInput.read('tags', others)).toEqual({ ok: false, issue: { code: 'reserved' } });
        expect(ScopeKeyInput.read('tv-status', others)).toEqual({ ok: false, issue: { code: 'reserved' } });
        expect(ScopeKeyInput.read('tv-end', others)).toEqual({ ok: false, issue: { code: 'duplicate' } });
    });

    it('reads the others as they are when it reads', () => {
        let keys = ['tv-end'];
        const codec = ScopeKeyInput.codec(() => keys);
        expect(codec.read('tv-end').ok).toBe(false);
        keys = ['tv-finish'];
        expect(codec.read('tv-end')).toEqual({ ok: true, value: 'tv-end' });
    });
});

describe('a status character typed in the settings', () => {
    it.each([' ', 'x', '/', '！', ']'])('takes %j as typed', (c) => {
        expect(StatusCharInput.read(c, ['-'])).toEqual({ ok: true, value: c });
    });

    it('refuses none, more than one, a line break, and another status\'s', () => {
        expect(StatusCharInput.read('', [])).toEqual({ ok: false, issue: { code: 'empty' } });
        expect(StatusCharInput.read('ab', [])).toEqual({ ok: false, issue: { code: 'shape', kind: 'statusChar' } });
        expect(StatusCharInput.read('\u2028', [])).toEqual({ ok: false, issue: { code: 'shape', kind: 'statusChar' } });
        expect(StatusCharInput.read('x', [' ', 'x'])).toEqual({ ok: false, issue: { code: 'duplicate' } });
    });
});

describe('a heading typed in the settings', () => {
    it('reads the name with the space around it taken off', () => {
        expect(HeadingInput.read('  Tasks ')).toEqual({ ok: true, value: 'Tasks' });
        expect(HeadingInput.read('Tasks #today')).toEqual({ ok: true, value: 'Tasks #today' });
    });

    it('refuses none, and the heading mark before the name', () => {
        expect(HeadingInput.read(' ')).toEqual({ ok: false, issue: { code: 'empty' } });
        expect(HeadingInput.read('## Tasks')).toEqual({ ok: false, issue: { code: 'notation', kind: 'headingMark' } });
    });
});
