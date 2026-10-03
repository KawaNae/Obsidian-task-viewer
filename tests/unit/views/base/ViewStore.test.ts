import { describe, it, expect } from 'vitest';
import { ViewStore } from '../../../../src/views/base/ViewStore';

interface S { a?: number; b?: string; list?: number[] }

describe('ViewStore', () => {
    it('holds the value it was made with, copied', () => {
        const initial: S = { a: 1 };
        const store = new ViewStore<S>(initial);
        expect(store.get()).toEqual({ a: 1 });
        expect(store.get()).not.toBe(initial);
    });

    it('merges a patch shallowly into a new value, leaving the old one as it was', () => {
        const store = new ViewStore<S>({ a: 1, b: 'x', list: [1] });
        const before = store.get();
        store.update({ a: 2 });
        expect(store.get()).toEqual({ a: 2, b: 'x', list: [1] });
        expect(before).toEqual({ a: 1, b: 'x', list: [1] });
        expect(store.get().list).toBe(before.list);
    });

    it('a key given as undefined clears the field', () => {
        const store = new ViewStore<S>({ a: 1, b: 'x' });
        store.update({ b: undefined });
        expect(store.get().b).toBeUndefined();
        expect(store.get().a).toBe(1);
    });

    it('tells every listener the patch and the value before it, in the order they subscribed', () => {
        const store = new ViewStore<S>({ a: 1 });
        const heard: string[] = [];
        store.subscribe((patch, prev) => heard.push(`first ${JSON.stringify(patch)} ${prev.a}`));
        store.subscribe((patch, prev) => heard.push(`second ${JSON.stringify(patch)} ${prev.a}`));
        store.update({ a: 5 });
        expect(heard).toEqual(['first {"a":5} 1', 'second {"a":5} 1']);
    });

    it('a listener reads the new value from the store', () => {
        const store = new ViewStore<S>({ a: 1 });
        let seen: number | undefined;
        store.subscribe(() => { seen = store.get().a; });
        store.update({ a: 3 });
        expect(seen).toBe(3);
    });

    it('tells a patch that changes nothing', () => {
        const store = new ViewStore<S>({ a: 1 });
        let count = 0;
        store.subscribe(() => count++);
        store.update({ a: 1 });
        store.update({});
        expect(count).toBe(2);
    });

    it('an unsubscribed listener hears nothing more', () => {
        const store = new ViewStore<S>({ a: 1 });
        let count = 0;
        const off = store.subscribe(() => count++);
        store.update({ a: 2 });
        off();
        store.update({ a: 3 });
        expect(count).toBe(1);
    });
});
