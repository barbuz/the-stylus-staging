/**
 * Thread presenter.
 *
 * Builds the Discord "Guru Match Help" text for a match and hands it to the
 * thread modal. Owns the link formatting, deck card formatting and correction
 * suffix; the controller only supplies the row and current pod details.
 */
import { DEPLOYMENTS } from '../config.js';
import { buildCorrectionString } from '../domain/analyses.js';
import { deploymentSheetLink } from '../domain/guruColor.js';

export class ThreadPresenter {
    constructor(scryfallAPI, threadModal) {
        this.scryfallAPI = scryfallAPI;
        this.threadModal = threadModal;
    }

    /** Deck string as pipe-separated card names, matching the modal's display. */
    formatDeck(deckString) {
        if (!deckString || !deckString.trim()) {
            return '';
        }
        return this.scryfallAPI.parseDeckString(deckString).join(' | ');
    }

    open({ row, rowIndex, spreadsheetId, podName, mainSheetLink, currentAnalysis }) {
        const matchNumber = rowIndex + 1;

        // A shared link always points at the canonical production URL; the
        // recipient's own deployment preference then decides where it opens.
        const matchLink = deploymentSheetLink(
            window.location.href,
            DEPLOYMENTS.production.path,
            spreadsheetId,
            mainSheetLink
        );

        const correctionString = buildCorrectionString(row, currentAnalysis);
        const threadText = `P1 - ${this.formatDeck(row.player1)}\nP2 - ${this.formatDeck(row.player2)}\n` +
            `[See match on The Stylus](${matchLink}) :Stylus:${correctionString}\n`;

        this.threadModal.open({
            titleText: `${podName} ${matchNumber}`,
            threadText,
            writeupCommand: `/writeup matchid:${podName} ${matchNumber}`
        });
    }
}
