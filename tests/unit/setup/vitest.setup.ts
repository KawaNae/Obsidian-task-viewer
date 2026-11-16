import { beforeEach } from 'vitest';
import { Notice } from '../mocks/obsidian';

// Every test reads only the notices it raised itself.
beforeEach(() => {
    Notice.messages.length = 0;
});
