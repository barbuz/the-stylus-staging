/**
 * Match table presenter.
 *
 * Turns the controller's row list and per-row predicates into the options the
 * match-table modal needs, including each row's status markup and highlight
 * class. Keeps the modal's wiring out of the controller.
 */
import { getCurrentColorSignature } from '../domain/guruColor.js';
import { describeMatchStatus, renderMatchStatus } from './matchStatus.js';

export class MatchTablePresenter {
    constructor(matchTableModal) {
        this.matchTableModal = matchTableModal;
    }

    async open({ rows, currentRowIndex, colour, signature, threadMap, statusFor, onSelect }) {
        await this.matchTableModal.open({
            rows,
            currentRowIndex,
            signatureFor: (row) => getCurrentColorSignature(row, colour) || '',
            rowClassFor: (row, idx) => {
                const rowSignature = getCurrentColorSignature(row, colour) || '';
                const highlight = idx === currentRowIndex ? 'current-row' : '';
                const currentGuruRow = rowSignature === signature ? 'current-guru-row' : '';
                return `${highlight} ${currentGuruRow}`;
            },
            statusMarkupFor: (row, idx) => renderMatchStatus(describeMatchStatus(statusFor(row, idx))),
            onSelect
        });
    }

    close() {
        this.matchTableModal.close();
    }
}
