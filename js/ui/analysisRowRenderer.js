/**
 * Analysis row renderer.
 *
 * Drives the per-row render pipeline for the scoring screen: it syncs the URL
 * and title, then pushes the row's state into AnalysisView and the card
 * presenter. The controller calls `render()`; this class owns the ordering and
 * the card preloading decisions, so the controller holds no rendering logic.
 */
export class AnalysisRowRenderer {
    constructor(host) {
        this.host = host;
    }

    /** Sync the browser URL and document title with the current session state. */
    updateURL() {
        const host = this.host;
        if (!host.currentData?.sheetId) return;

        const newUrl = new URL(window.location);
        newUrl.search = '';
        newUrl.searchParams.set('pod', host.currentData.sheetId);

        if (host.currentRowIndex !== undefined && host.allRows?.length > 0) {
            newUrl.searchParams.set('match', (host.currentRowIndex + 1).toString());
        }
        if (host.currentGuruColor) {
            newUrl.searchParams.set('guru', host.currentGuruColor);
        }

        window.history.replaceState({
            podId: host.currentData.sheetId,
            guruColor: host.currentGuruColor,
            rowIndex: host.currentRowIndex
        }, '', newUrl);

        const podName = host.currentData?.metadata?.podName || host.currentData?.title || 'Unknown Pod';
        const matchId = host.currentRowIndex === null ? '' : host.currentRowIndex + 1;
        document.title = `${podName} ${matchId}`;
    }

    updateGuruColorDisplay() {
        const host = this.host;
        host.view.renderGuruColor(host.currentGuruColor);
        host.guruColorSelector?.update(host.currentGuruColor);
    }

    async render() {
        const host = this.host;
        this.updateURL();

        host.view.renderSheetInfo({
            sheetId: host.currentData.sheetId,
            title: host.currentData.title,
            podName: host.currentData.metadata?.podName,
            matchNumber: host.currentRowIndex + 1
        });

        if (host.currentRowIndex >= host.allRows.length || host.currentRowIndex < 0) {
            host.showMatchTableModal();
            return;
        }

        const currentRow = host.allRows[host.currentRowIndex];

        host.view.renderProgress(host.currentRowIndex, host.allRows.length);
        this.updateGuruColorDisplay();

        const cards1Loaded = host.cards.loadPlayerCards('player1', currentRow.player1);
        const cards2Loaded = host.cards.loadPlayerCards('player2', currentRow.player2);
        this.displayDeckInfo('player1', currentRow.player1);
        this.displayDeckInfo('player2', currentRow.player2);

        host.view.renderOutcome(currentRow.outcomeValue);

        await this.renderAnalysisDisplay(currentRow);

        const currentAnalysis = host.getCurrentColorAnalysis(currentRow);
        const currentAnalysisValue = currentAnalysis ? parseFloat(currentAnalysis) : null;
        host.view.renderButtons({
            row: currentRow,
            colour: host.currentGuruColor,
            signature: host.guruSignature,
            analysisValue: currentAnalysisValue,
            deckStats: host.getDeckStats()
        });

        host.view.renderNavigation(host.currentRowIndex, host.allRows.length);
        host.view.renderDiscrepancyButton(host.numDiscrepancies);
        host.updateInverseResultDisplay();

        await cards1Loaded;
        await cards2Loaded;

        host.cards.preloadRows(host.allRows, this.rowsToPreload());
    }

    /** Build the analysis list, fetching its Discord thread link if any. */
    async renderAnalysisDisplay(currentRow) {
        const host = this.host;
        const showOtherGurus = !host.isMatchAvailableForAnalysis(currentRow);
        const threadUrl = await this.getThreadUrl(currentRow);
        host.view.buildAnalysisList({
            row: currentRow,
            outcomeValue: currentRow.outcomeValue || '',
            colour: host.currentGuruColor,
            showOtherGurus,
            threadUrl,
            rowIndex: host.currentRowIndex
        });
    }

    async getThreadUrl(currentRow) {
        const host = this.host;
        if (!host.hub) {
            return null;
        }
        try {
            const rowId = currentRow.rowIndex || host.currentRowIndex + 1;
            return await host.hub.getThreadById(rowId);
        } catch (error) {
            console.warn('Failed to fetch thread link:', error);
            return null;
        }
    }

    displayDeckInfo(playerId, deckString) {
        const host = this.host;
        const deckInfo = host.deckNotesMap?.get(deckString) || null;
        host.view.renderDeckInfo(playerId, deckString, deckInfo, {
            onSaveField: (deck, type, oldValue, newValue, span) =>
                host.saveDeckInfoField(deck, type, oldValue, newValue, span)
        });
    }

    /** Indices worth warming: the next empty, plus the adjacent rows. */
    rowsToPreload() {
        const host = this.host;
        const indices = new Set();

        const nextEmptyIndex = host.findFirstEmptyAnalysis(host.currentRowIndex + 1);
        if (nextEmptyIndex != null) {
            indices.add(nextEmptyIndex);
        }

        for (const offset of [1, -1]) {
            const index = host.currentRowIndex + offset;
            if (index >= 0 && index < host.allRows.length) {
                indices.add(index);
            }
        }

        return indices;
    }
}
