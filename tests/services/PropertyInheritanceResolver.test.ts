import { describe, it, expect } from 'vitest';
import { PropertyInheritanceResolver } from '../../src/services/core/PropertyInheritanceResolver';
import { makeTask } from '../helpers/makeTask';
import type { PropertyValue } from '../../src/types';

/** Shorthand: create a string PropertyValue */
const pv = (value: string, type: PropertyValue['type'] = 'string'): PropertyValue => ({ value, type });

describe('PropertyInheritanceResolver', () => {
    it('single-level: child inherits parent properties', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], properties: { priority: pv('high') } });
        const child = makeTask({ id: 'c', parentId: 'p', properties: {} });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.properties).toEqual({ priority: pv('high') });
    });

    it('child-wins: child property overrides parent', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], properties: { priority: pv('low') } });
        const child = makeTask({ id: 'c', parentId: 'p', properties: { priority: pv('high') } });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.properties).toEqual({ priority: pv('high') });
    });

    it('multi-level: grandparent → parent → child cascade', () => {
        const gp = makeTask({ id: 'gp', childIds: ['p'], properties: { a: pv('1') } });
        const parent = makeTask({ id: 'p', parentId: 'gp', childIds: ['c'], properties: { b: pv('2') } });
        const child = makeTask({ id: 'c', parentId: 'p', properties: { c: pv('3') } });
        PropertyInheritanceResolver.resolve([gp, parent, child]);
        expect(child.properties).toEqual({ a: pv('1'), b: pv('2'), c: pv('3') });
        expect(parent.properties).toEqual({ a: pv('1'), b: pv('2') });
    });

    it('multi-level override: child overrides grandparent key', () => {
        const gp = makeTask({ id: 'gp', childIds: ['p'], properties: { x: pv('old') } });
        const parent = makeTask({ id: 'p', parentId: 'gp', childIds: ['c'], properties: {} });
        const child = makeTask({ id: 'c', parentId: 'p', properties: { x: pv('new') } });
        PropertyInheritanceResolver.resolve([gp, parent, child]);
        expect(child.properties).toEqual({ x: pv('new') });
        expect(parent.properties).toEqual({ x: pv('old') });
    });

    it('empty parent properties: child unchanged', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], properties: {} });
        const child = makeTask({ id: 'c', parentId: 'p', properties: { own: pv('val') } });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.properties).toEqual({ own: pv('val') });
    });

    it('root tasks: no change', () => {
        const root = makeTask({ id: 'r', properties: { a: pv('1') } });
        PropertyInheritanceResolver.resolve([root]);
        expect(root.properties).toEqual({ a: pv('1') });
    });

    it('multiple children inherit same parent properties', () => {
        const parent = makeTask({ id: 'p', childIds: ['c1', 'c2'], properties: { shared: pv('yes') } });
        const c1 = makeTask({ id: 'c1', parentId: 'p', properties: { own1: pv('a') } });
        const c2 = makeTask({ id: 'c2', parentId: 'p', properties: { own2: pv('b') } });
        PropertyInheritanceResolver.resolve([parent, c1, c2]);
        expect(c1.properties).toEqual({ shared: pv('yes'), own1: pv('a') });
        expect(c2.properties).toEqual({ shared: pv('yes'), own2: pv('b') });
    });

    // --- Tag inheritance ---

    it('tags: child inherits parent tags', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], tags: ['work', 'urgent'] });
        const child = makeTask({ id: 'c', parentId: 'p', tags: [] });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.tags).toEqual(expect.arrayContaining(['work', 'urgent']));
        expect(child.tags).toHaveLength(2);
    });

    it('tags: child tags merged with parent, deduplicated', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], tags: ['work', 'urgent'] });
        const child = makeTask({ id: 'c', parentId: 'p', tags: ['urgent', 'personal'] });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.tags).toEqual(expect.arrayContaining(['work', 'urgent', 'personal']));
        expect(child.tags).toHaveLength(3);
    });

    it('tags: multi-level cascade', () => {
        const gp = makeTask({ id: 'gp', childIds: ['p'], tags: ['a'] });
        const parent = makeTask({ id: 'p', parentId: 'gp', childIds: ['c'], tags: ['b'] });
        const child = makeTask({ id: 'c', parentId: 'p', tags: ['c'] });
        PropertyInheritanceResolver.resolve([gp, parent, child]);
        expect(parent.tags).toEqual(expect.arrayContaining(['a', 'b']));
        expect(child.tags).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    });

    it('tags: parent with no tags does not affect child', () => {
        const parent = makeTask({ id: 'p', childIds: ['c'], tags: [] });
        const child = makeTask({ id: 'c', parentId: 'p', tags: ['own'] });
        PropertyInheritanceResolver.resolve([parent, child]);
        expect(child.tags).toEqual(['own']);
    });
});
