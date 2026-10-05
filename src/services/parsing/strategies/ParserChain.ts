import type { UnnamedTask } from '../TaskFactory';
import type { LeafParserStrategy, ParserStrategy } from './ParserStrategy';

/**
 * Chain of Responsibility pattern for multiple parser support.
 * Tries each parser in order until one successfully parses the line.
 */
export class ParserChain implements ParserStrategy {
    private parsers: LeafParserStrategy[];

    constructor(parsers: LeafParserStrategy[]) {
        if (parsers.length === 0) {
            throw new Error('ParserChain requires at least one parser');
        }
        this.parsers = parsers;
    }

    /**
     * Try each parser in order until one succeeds.
     */
    parse(line: string, filePath: string, lineNumber: number): UnnamedTask | null {
        for (const parser of this.parsers) {
            const result = parser.parse(line, filePath, lineNumber);
            if (result !== null) return result;
        }
        return null;
    }
}
