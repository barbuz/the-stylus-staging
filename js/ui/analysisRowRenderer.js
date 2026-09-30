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
        const { state } = this.host;
        if (!state.spreadsheetId) return;

        const newUrl = new URL(window.location);
        newUrl.search = '';
        newUrl.searchParams.set('pod', state.spreadsheetId);

        if (state.rowIndex !== undefined && state.rows.length > 0) {
            newUrl.searchParams.set('match', (state.rowIndex + 1).toString());
        }
        if (state.guruColor) {
            newUrl.searchParams.set('guru', state.guruColor);
        }

        window.history.replaceState({
            podId: state.spreadsheetId,
            guruColor: state.guruColor,
            rowIndex: state.rowIndex
        }, '', newUrl);

        const podName = state.sheetData?.metadata?.podName || state.sheetData?.title || 'Unknown Pod';
        const matchId = state.rowIndex === null ? '' : state.rowIndex + 1;
        document.title = `${podName} ${matchId}`;
    }

    updateGuruColorDisplay() {
        const host = this.host;
        host.view.renderGuruColor(host.state.guruColor);
        host.guruColorSelector?.update(host.state.guruColor);
    }

    async render() {
        const host = this.host;
        const { state } = host;
        this.updateURL();

        host.view.renderSheetInfo({
            spreadsheetId: state.spreadsheetId,
            title: state.sheetData.title,
            podName: state.sheetData.metadata?.podName,
            matchNumber: state.rowIndex + 1
        });

        if (state.rowIndex >= state.rows.length || state.rowIndex < 0) {
            host.showMatchTableModal();
            return;
        }

        const currentRow = state.rows[state.rowIndex];

        host.view.renderProgress(state.rowIndex, state.rows.length);
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
            colour: state.guruColor,
            signature: state.signature,
            analysisValue: currentAnalysisValue,
            deckStats: host.getDeckStats()
        });

        host.view.renderNavigation(state.rowIndex, state.rows.length);
        host.view.renderDiscrepancyButton(state.numDiscrepancies);
        host.updateInverseResultDisplay();

        await cards1Loaded;
        await cards2Loaded;

        host.cards.preloadRows(state.rows, this.rowsToPreload());
    }

    /** Build the analysis list, fetching its Discord thread link if any. */
    async renderAnalysisDisplay(currentRow) {
        const host = this.host;
        const showOtherGurus = !host.isMatchAvailableForAnalysis(currentRow);
        const threadUrl = await this.getThreadUrl(currentRow);
        host.view.buildAnalysisList({
            row: currentRow,
            outcomeValue: currentRow.outcomeValue || '',
            colour: host.state.guruColor,
            showOtherGurus,
            threadUrl,
            rowIndex: host.state.rowIndex
        });
    }

    async getThreadUrl(currentRow) {
        const host = this.host;
        if (!host.state.hub) {
            return null;
        }
        try {
            const rowId = currentRow.rowIndex || host.state.rowIndex + 1;
            return await host.state.hub.getThreadById(rowId);
        } catch (error) {
            console.warn('Failed to fetch thread link:', error);
            return null;
        }
    }

    displayDeckInfo(playerId, deckString) {
        const host = this.host;
        const deckInfo = host.state.deckNotesMap?.get(deckString) || null;
        host.view.renderDeckInfo(playerId, deckString, deckInfo, {
            onSaveField: (deck, type, oldValue, newValue, span) =>
                host.saveDeckInfoField(deck, type, oldValue, newValue, span)
        });
    }

    /** Indices worth warming: the next empty, plus the adjacent rows. */
    rowsToPreload() {
        const host = this.host;
        const { state } = host;
        const indices = new Set();

        const nextEmptyIndex = host.findFirstEmptyAnalysis(state.rowIndex + 1);
        if (nextEmptyIndex != null) {
            indices.add(nextEmptyIndex);
        }

        for (const offset of [1, -1]) {
            const index = state.rowIndex + offset;
            if (index >= 0 && index < state.rows.length) {
                indices.add(index);
            }
        }

        return indices;
    }
}
