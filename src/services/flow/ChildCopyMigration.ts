import { TIMER_ICON_PREFIX_RE } from '../../utils/TimerIcons';
import { type Diagnostic, warning } from '../lang/Diagnostic';
import { TaskLineClassifier } from '../parsing/utils/TaskLineClassifier';
import type { FlowProgram } from './FlowAst';
import { isFlowLine } from './FlowLineScanner';

/**
 * Tell a task that its child lines have stopped travelling to the next
 * instance.
 *
 * The line that breaks is the one nobody edited. A command that copied its
 * children still reads exactly as it did, so without a word here the change
 * only shows up the next time it fires, in a file the user then has to
 * repair. A generation block is where carried-over items live now.
 *
 * Silence is the answer in three cases, each for its own reason. A task that
 * names a block has already moved. A task whose children are all timer
 * records is the one this redesign was built for — records piling up
 * unfinished in every generation is the fault being fixed, so telling its
 * owner to migrate would be advice against their own interest. And a command
 * that generates nothing copies nothing either, so there is no loss to
 * report.
 *
 * The span is left empty. What is wrong is the whole arrangement of the task
 * and its children rather than any stretch of text, so the caller anchors
 * the mark where it makes sense on screen.
 *
 * @param childLines the task's child lines, its flow children included
 */
export function childCopyMigrationWarning(
    program: FlowProgram,
    childLines: string[],
): Diagnostic | null {
    if (!program.schedule || program.use || program.nochildren) return null;

    const carried = childLines.filter(line => line.trim() !== '' && !isFlowLine(line));
    if (carried.length === 0 || carried.every(isTimerRecord)) return null;

    return warning('flow.child-copy-retired',
        'Child lines no longer travel to the next instance — put what should carry over in a tv-gen block and name it with use("...")',
        { start: 0, end: 0 });
}

/**
 * A line written by the timer rather than by hand.
 *
 * The icon is the mark, read through the same list the timer writes from.
 * A record is always a checkbox line, so a note bullet that happens to open
 * with the icon is not one.
 */
function isTimerRecord(line: string): boolean {
    const content = TaskLineClassifier.classify(line)?.rawContent;
    return content !== undefined && TIMER_ICON_PREFIX_RE.test(content);
}
