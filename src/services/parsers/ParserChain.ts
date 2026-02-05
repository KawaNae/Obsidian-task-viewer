import { Task } from '../../types';
import { ParserStrategy } from './ParserStrategy';

/**
 * Chain of Responsibility pattern for multiple parser support.
 * Tries each parser in order until one successfully parses the line.
 */
export class ParserChain implements ParserStrategy {
    readonly id = 'chain';
    private parsers: ParserStrategy[];

    constructor(parsers: ParserStrategy[]) {
        if (parsers.length === 0) {
            throw new Error('ParserChain requires at least one parser');
        }
        this.parsers = parsers;
    }

    /**
     * Try each parser in order until one succeeds.
     */
    parse(line: string, filePath: string, lineNumber: number): Task | null {
        for (const parser of this.parsers) {
            const result = parser.parse(line, filePath, lineNumber);
            if (result !== null) {
                result.parserId = parser.id; // Record which parser was used
                return result;
            }
        }
        return null;
    }

    /**
     * Format using the original parser that parsed this task.
     */
    format(task: Task): string {
        if (task.parserId) {
            const parser = this.parsers.find(p => p.id === task.parserId);
            if (parser) {
                return parser.format(task);
            }
        }
        // Fallback: use originalText or first parser
        return task.originalText || this.parsers[0].format(task);
    }

    /**
     * Delegate to the original parser, or use common logic.
     */
    isTriggerableStatus(task: Task): boolean {
        if (task.parserId) {
            const parser = this.parsers.find(p => p.id === task.parserId);
            if (parser) {
                return parser.isTriggerableStatus(task);
            }
        }
        // Fallback: use first parser's logic (should be safe for status chars)
        return this.parsers[0].isTriggerableStatus(task);
    }

    /**
     * Add a parser to the chain.
     */
    addParser(parser: ParserStrategy): void {
        this.parsers.push(parser);
    }

    /**
     * Get all parsers in the chain.
     */
    getParsers(): readonly ParserStrategy[] {
        return this.parsers;
    }
}
