import type { CliData } from 'obsidian';
import { CLI_REFERENCE } from '../../api/Reference';

/** The CLI's `help`: the reference made from the tables the CLI runs on (`api/Reference`). */
export function createHelpHandler() {
    return (_params: CliData): string => CLI_REFERENCE;
}
