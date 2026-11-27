import { describe, it, expect } from 'vitest';
import { carryPressKeys, commitOf, ownCommit, pressUnderWay } from '../../../src/views/sharedUI/PressCommit';
import { FocusDoc, asEl } from '../helpers/focusDom';

describe('the press under way and the keys of the buttons a commit builds anew', () => {
    const doc = new FocusDoc();
    const asDoc = doc as unknown as Document;

    it('gives back the key the button pressed has once the commit ran: moved, taken out, or as it was', () => {
        const moves = new Map([['list:item:2', 'list:item:1'], ['list:item:0', null]]);
        expect(pressUnderWay(asDoc, 'list:item:2', () => { carryPressKeys(asDoc, moves); return 'r'; })).toEqual({ result: 'r', key: 'list:item:1' });
        expect(pressUnderWay(asDoc, 'list:item:0', () => carryPressKeys(asDoc, moves)).key).toBeNull();
        expect(pressUnderWay(asDoc, 'tags:a:remove', () => carryPressKeys(asDoc, moves)).key).toBe('tags:a:remove');
    });

    it('moves no key while no press is under way', () => {
        expect(() => carryPressKeys(asDoc, new Map([['k', null]]))).not.toThrow();
    });

    it('lets a field\'s commit go once its signal aborts', () => {
        const field = asEl(doc.root().createEl('input'));
        const built = new AbortController();
        const commit = { typed: () => true, commit: () => true };
        ownCommit(field, commit, built.signal);
        expect(commitOf(field)).toBe(commit);
        built.abort();
        expect(commitOf(field)).toBeNull();
        expect(commitOf(null)).toBeNull();
    });
});
