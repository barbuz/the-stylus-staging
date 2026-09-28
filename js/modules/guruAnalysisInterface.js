/**
 * Guru Analysis Interface
 * Handles the single-row analysis interface for guru decisions
*/
import { ScryfallAPI } from './scryfallAPI.js';
import { DeckNotesEditor } from './deckNotesEditor.js';
import { HubManager } from './hubManager.js';
import { DEPLOYMENTS } from '../config.js';
import {
    calculateOutcomeFromAnalyses,
    normalizeAnalysisForComparison,
    getGuruAnalysisValues,
    getAnalysisClass,
    formatAnalysisValue,
    getAnalysisLabel,
    getOutcomeDisplayName,
    buildCorrectionString
} from '../domain/analyses.js';
import {
    GURU_COLORS,
    DEFAULT_GURU_COLOUR,
    getCurrentColorAnalysis,
    getCurrentColorSignature,
    setColourAnalysis,
    setColourSignature,
    colourLabel,
    emptyColumnIndex,
    buildColumnIndex,
    getCurrentGuruColIndex,
    getGuruColorInRow
} from '../domain/guruColor.js';
import {
    findColumnIndex,
    buildMatchRows,
    rowHasCurrentGuruSignature,
    rowHasCurrentGuruSignatureInColor,
    rowHasEmptySignature,
    hasCurrentColorResult,
    rowHasDiscrepancy,
    rowHasMyDiscrepancy,
    allGurusHaveMatchingResults,
    isMatchAvailableForAnalysis,
    isCurrentMatchAvailableForAnalysis,
    isAnalysisComplete,
    findFirstEmptyAnalysis,
    findFirstDiscrepancy,
    findNextDeck,
    findMirrorMatchIndex,
    getDeckStats
} from '../domain/matchRows.js';
import { isInverseErrorSuspected, isOutcomeValueValidForInverse } from '../domain/inverseCheck.js';

export class GuruAnalysisInterface {
    constructor(sheetsAPI, uiController, guruSignature) {
        this.sheetsAPI = sheetsAPI;
        this.uiController = uiController;
        this.guruSignature = guruSignature;
        this.hub = null;
        this.scryfallAPI = new ScryfallAPI();
        this.currentData = null;
        this.allRows = [];
        this.currentRowIndex = -1;
        this.currentGuruColor = null;
        this.numDiscrepancies = 0;
        // Single per-colour column index: { red: { analysis, signature }, ... }
        this.columnIndex = emptyColumnIndex();
        this.bindEvents();
    }

    reset() {
        this.hub = null;
        this.currentData = null;
        this.allRows = [];
        this.currentRowIndex = -1;
        this.currentGuruColor = null;
        this.numDiscrepancies = 0;
        this.columnIndex = emptyColumnIndex();
    }

    /**
     * Updates the guru signature used for filtering and claiming matches
     * @param {string} signature - The new guru signature
     */
    setGuruSignature(signature) {
        if (this.guruSignature !== signature) {
            this.guruSignature = signature;
            console.log(`Guru signature updated to: ${signature}`);
        }
    }

    determineGuruColorFromSheet(sheetData) {
        // Get the current guru signature
        let currentSignature = this.guruSignature || '';

        if (!currentSignature.trim()) {
            console.log('No guru signature found, defaulting to red');
            return DEFAULT_GURU_COLOUR;
        }

        // Find the merged guru sheet
        const mergedGuruSheet = sheetData.sheets?.find(sheet => 
            sheet.title === 'Merged Gurus'
        );

        if (!mergedGuruSheet || !mergedGuruSheet.values || mergedGuruSheet.values.length < 2) {
            console.log('No merged guru sheet found, defaulting to red');
            return DEFAULT_GURU_COLOUR;
        }

        const headerRow = mergedGuruSheet.values[0];

        // Find signature columns, one per colour
        const signatureCols = Object.fromEntries(
            GURU_COLORS.map(colour => [colour, findColumnIndex(headerRow, [`${colourLabel(colour)} Signature`])])
        );

        console.log('Signature column indices:', { ...signatureCols, currentSignature });

        // Start searching from current row index if available, otherwise start from row 1
        const startRowIndex = (this.currentRowIndex !== undefined && this.currentRowIndex >= 0) 
            ? this.currentRowIndex + 1  // +1 because currentRowIndex is 0-based, but row indices here start at 1
            : 1;
        const totalRows = mergedGuruSheet.values.length;

        // Check each signature column for the current guru's signature
        // Start from current row, go to end, then loop back from beginning to current
        for (let i = 0; i < totalRows - 1; i++) {
            const rowIndex = ((startRowIndex - 1 + i) % (totalRows - 1)) + 1; // -1 and +1 to handle header row
            const row = mergedGuruSheet.values[rowIndex];

            for (const colour of GURU_COLORS) {
                const colIndex = signatureCols[colour];
                if (colIndex !== -1 && row[colIndex] === currentSignature) {
                    console.log(`Found guru signature "${currentSignature}" in ${colourLabel(colour)} column at row ${rowIndex}`);
                    return colour;
                }
            }
        }

        console.log(`Guru signature "${currentSignature}" not found in any column`);
        throw new Error(`Guru signature "${currentSignature}" not found in any analysis column. Please check that you have matches assigned to analyse.`);
    }

    bindEvents() {
        // Analysis buttons
        document.getElementById('win-btn').addEventListener('click', () => this.setAnalysis(1.0));
        document.getElementById('tie-btn').addEventListener('click', () => this.setAnalysis(0.5));
        document.getElementById('loss-btn').addEventListener('click', () => this.setAnalysis(0.0));

        // Navigation buttons
        document.getElementById('prev-btn').addEventListener('click', () => this.previousRow());
        document.getElementById('next-btn').addEventListener('click', () => this.nextRow());
        document.getElementById('skip-btn').addEventListener('click', () => this.skipToNextIncomplete());
        document.getElementById('discrepancy-btn').addEventListener('click', () => this.skipToNextDiscrepancy());
        document.getElementById('mirror-match-btn').addEventListener('click', () => this.skipToMirrorMatch());
        document.getElementById('next-deck-btn').addEventListener('click', () => this.skipToNextDeck());

        // Guru color selector
        this.bindGuruColorSelector();

        // --- MATCH TABLE MODAL ---
        document.getElementById('current-row-info').addEventListener('click', () => this.showMatchTableModal());
        
        // --- CREATE THREAD TEXT MODAL ---
        // Use event delegation since button is dynamically created
        document.addEventListener('click', (e) => {
            if (e.target.closest('.create-thread-btn')) {
                const btn = e.target.closest('.create-thread-btn');
                const rowIndex = parseInt(btn.dataset.rowIndex);
                this.showCreateThreadModal(rowIndex);
            }
            if (e.target.closest('.close-thread-modal')) {
                this.closeCreateThreadModal();
            }
            if (e.target.classList.contains('thread-modal-overlay')) {
                this.closeCreateThreadModal();
            }
        });
    }

    bindGuruColorSelector() {
        const trigger = document.getElementById('sheet-name-info');
        const dropdown = document.getElementById('guru-color-dropdown');
        
        if (!trigger || !dropdown) {
            console.warn('Guru color selector elements not found');
            return;
        }

        // Toggle dropdown on trigger click
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('show');
            
            if (isOpen) {
                this.closeGuruColorDropdown();
            } else {
                this.openGuruColorDropdown();
            }
        });

        // Handle color selection
        dropdown.addEventListener('click', (e) => {
            const option = e.target.closest('.guru-color-option');
            if (option) {
                const selectedColor = option.dataset.color;
                this.changeGuruColor(selectedColor);
                this.closeGuruColorDropdown();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
                this.closeGuruColorDropdown();
            }
        });

        // Close dropdown on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeGuruColorDropdown();
            }
        });
    }

    openGuruColorDropdown() {
        const trigger = document.getElementById('sheet-name-info');
        const dropdown = document.getElementById('guru-color-dropdown');
        
        trigger.classList.add('active');
        dropdown.classList.add('show');
        
        // Update current color indicator
        this.updateGuruColorDropdown();
    }

    closeGuruColorDropdown() {
        const trigger = document.getElementById('sheet-name-info');
        const dropdown = document.getElementById('guru-color-dropdown');
        
        trigger.classList.remove('active');
        dropdown.classList.remove('show');
    }

    updateGuruColorDropdown() {
        const dropdown = document.getElementById('guru-color-dropdown');
        if (!dropdown) return;

        // Remove current class from all options
        dropdown.querySelectorAll('.guru-color-option').forEach(option => {
            option.classList.remove('current');
        });

        // Add current class to the active guru color
        if (this.currentGuruColor) {
            const currentOption = dropdown.querySelector(`[data-color="${this.currentGuruColor}"]`);
            if (currentOption) {
                currentOption.classList.add('current');
            }
        }
    }

    async changeGuruColor(newColor) {
        if (newColor === this.currentGuruColor) {
            return; // No change needed
        }

        try {            
            const oldColor = this.currentGuruColor;
            this.currentGuruColor = newColor;
            
            console.log(`Switching guru color from ${oldColor} to ${newColor}`);
            
            // Update the display immediately
            this.updateGuruColorDisplay();
            // Show the current row with the new guru color perspective
            await this.showCurrentRow();
            
            this.uiController.showStatus(`Switched to ${newColor} guru`, 'success');
            
        } catch (error) {
            console.error('Error changing guru color:', error);
            this.uiController.showStatus(`Error switching guru color: ${error.message}`, 'error');
            
            // Revert to old color on error
            this.currentGuruColor = oldColor;
            this.updateGuruColorDisplay();
        }
    }

    updateGuruColorDisplay() {
        const trigger = document.getElementById('sheet-name-info');
        if (trigger && this.currentGuruColor) {
            trigger.textContent = `${this.currentGuruColor.charAt(0).toUpperCase() + this.currentGuruColor.slice(1)} Guru`;
        }
        
        // Update dropdown current indicator
        this.updateGuruColorDropdown();
    }

    /**
     * Update the browser URL with current pod ID, guru color, and row number
     */
    updateURL() {
        if (!this.currentData?.sheetId) return;
        
        const newUrl = new URL(window.location);
        // Remove all existing query parameters
        newUrl.search = '';
        newUrl.searchParams.set('pod', this.currentData.sheetId);
        
        if (this.currentRowIndex !== undefined && this.allRows?.length > 0) {
            newUrl.searchParams.set('match', (this.currentRowIndex + 1).toString());
        }
        
        if (this.currentGuruColor) {
            newUrl.searchParams.set('guru', this.currentGuruColor);
        }

        window.history.replaceState({ 
            podId: this.currentData.sheetId,
            guruColor: this.currentGuruColor,
            rowIndex: this.currentRowIndex 
        }, '', newUrl);

        // Update title with current spreadsheet title
        const podName = this.currentData?.metadata?.podName || this.currentData?.title || 'Unknown Pod';
        const matchId = this.currentRowIndex === null ? '' : this.currentRowIndex+1;
        document.title = `${podName} ${matchId}`;
    }

    async loadData(sheetData, guruColor = null, rowNumber = 0) {
        this.currentData = sheetData;

        if (sheetData.sheets.some(sheet => sheet.title === 'Merged Gurus' && sheet.hidden)) {
            const notesData = sheetData.sheets.find(sheet => sheet.title === 'Deck Notes');
            if (notesData) {
                // Show deck notes editor if available
                this.showDeckNotesEditor(notesData);
                return false;
            } else {
                this.uiController.showError('No Deck Notes sheet found. Please ensure it exists to continue.');
                return false;
            }
        }

        if (sheetData.metadata?.guruHubLink && sheetData.metadata?.podName ) {
            if (!this.hub) {
                this.hub = new HubManager(sheetData.metadata.guruHubLink, sheetData.metadata.podName);
            }
            this.hub.loadThreads();
        }

        if (rowNumber !== null && rowNumber > 0) {
            this.currentRowIndex = rowNumber - 1;
        }
        
        if (guruColor === null) {
            try {
                // Determine the current guru color from the actual sheet data
                this.currentGuruColor = this.determineGuruColorFromSheet(sheetData);
                console.log(`Determined guru color: ${this.currentGuruColor}`);
            } catch (error) {                
                // Check if this is a "signature not found" error - offer color selection
                if (error.message.includes('not found in any analysis column')) {
                    this.showGuruColorSelection(sheetData); 
                    return false;
                } else {
                    // For other errors, show a generic error message
                    console.error('Error determining guru color:', error);
                    this.uiController.showError('An error occurred while determining guru color');
                    return false;
                }
            }
        } else if (guruColor !== null) {
            this.currentGuruColor = guruColor.toLowerCase();
        }
        
        this.allRows = [];

        // Process deck notes for reference
        const deckNotesResult = this.processDeckNotes(sheetData);
        this.deckNotesMap = deckNotesResult.deckNotesMap;
        this.deckNotesColumnMap = deckNotesResult.columnMap;
        console.log('Loaded deck notes:', this.deckNotesMap.size, 'entries');

        // Process all sheets and collect rows that need analysis
        if (sheetData.sheets && Array.isArray(sheetData.sheets)) {
            sheetData.sheets.forEach((sheet, sheetIndex) => {
                if (sheet.values && sheet.values.length > 1) {
                    this.processSheet(sheet, sheetIndex);
                }
            });
        }

        if (this.allRows.length === 0) {
            this.showNoDataMessage();
        } else {
            if (this.currentRowIndex === null || this.currentRowIndex === undefined || this.currentRowIndex < 0 || this.currentRowIndex >= this.allRows.length) {
                // Find the first row with empty Guru Analysis
                let firstEmpty = this.findFirstEmptyAnalysis();
                if (firstEmpty == null) {
                    this.currentRowIndex = 0;
                    this.showCompletionMessage();
                } else {
                    this.currentRowIndex = firstEmpty;
                }
            }
        }
        return true;
    }

    processDeckNotes(sheetData) {
        const deckNotesMap = new Map();
        
        if (!sheetData.sheets) {
            console.log('No sheets found in sheetData');
            return deckNotesMap;
        }
        
        // Find the "Deck Notes" sheet
        const deckNotesSheet = sheetData.sheets.find(sheet => 
            sheet.title && sheet.title.toLowerCase().includes('deck notes')
        );
        
        if (!deckNotesSheet) {
            console.log('No "Deck Notes" sheet found. Available sheets:', 
                sheetData.sheets.map(s => s.title));
            return deckNotesMap;
        }
                
        if (!deckNotesSheet.values || deckNotesSheet.values.length < 2) {
            console.log('Deck Notes sheet has no data or insufficient rows');
            return deckNotesMap;
        }
        
        const headerRow = deckNotesSheet.values[0];
        
        const decklistsColIndex = findColumnIndex(headerRow, ['Decklists', 'Decklist']);
        const goldfishClockColIndex = findColumnIndex(headerRow, ['Goldfish Clock', 'Clock']);
        const goldfishSignatureColIndex = findColumnIndex(headerRow, ['Goldfish Signature', 'Signature']);
        const notesColIndex = findColumnIndex(headerRow, ['Notes']);
        const additionalNotesColIndex = findColumnIndex(headerRow, ['Additional Notes', 'Add Notes']);

        const columnMap = {
            decklists: decklistsColIndex,
            goldfishClock: goldfishClockColIndex,
            goldfishSignature: goldfishSignatureColIndex,
            notes: notesColIndex,
            additionalNotes: additionalNotesColIndex
        };
        
        if (decklistsColIndex === -1) {
            console.log('Decklists column not found');
            return deckNotesMap;
        }
        
        // Process each row
        for (let i = 1; i < deckNotesSheet.values.length; i++) {
            const row = deckNotesSheet.values[i];
            const decklist = row[columnMap.decklists];
            
            if (decklist && decklist.trim()) {
                const deckInfo = {row: i};
                
                if (columnMap.goldfishClock !== -1 && row[columnMap.goldfishClock]) {
                    deckInfo.goldfishClock = row[columnMap.goldfishClock].toString().trim();
                }
                
                if (columnMap.goldfishSignature !== -1 && row[columnMap.goldfishSignature]) {
                    deckInfo.goldfishSignature = row[columnMap.goldfishSignature].toString().trim();
                }
                
                if (columnMap.notes !== -1 && row[columnMap.notes]) {
                    const notes = row[columnMap.notes].toString().trim();
                    if (notes) deckInfo.notes = notes;
                }
                
                if (columnMap.additionalNotes !== -1 && row[columnMap.additionalNotes]) {
                    const additionalNotes = row[columnMap.additionalNotes].toString().trim();
                    if (additionalNotes) deckInfo.additionalNotes = additionalNotes;
                }
                
                if (Object.keys(deckInfo).length > 0) {
                    deckNotesMap.set(decklist.trim(), deckInfo);
                }
            }
        }
        
        console.log('Total deck notes processed:', deckNotesMap.size);
        return {
            deckNotesMap:deckNotesMap,
            columnMap:columnMap
        };
    }

    processSheet(sheet, sheetIndex) {
        const headerRow = sheet.values[0];
        
        // Handle different sheet types
        if (sheet.title === 'Merged Gurus') {
            // For merged guru sheet, use the merged column structure
            this.processMergedGuruSheet(sheet, sheetIndex);
        } else {
            // For deck notes or other sheets, skip processing
            console.log(`Skipping sheet "${sheet.title}" - not a guru analysis sheet`);
            return;
        }
    }

    processMergedGuruSheet(sheet, sheetIndex) {
        const { rows, columnIndices, numDiscrepancies } = buildMatchRows(
            sheet, sheetIndex, this.currentGuruColor, this.guruSignature
        );

        // Store the resolved column index as a single per-colour structure
        this.columnIndex = buildColumnIndex(columnIndices);

        this.allRows.push(...rows);
        this.numDiscrepancies = numDiscrepancies;
    }

    // The methods below delegate to js/domain/. They are kept on the class so
    // the rendering and event call sites do not need to change in this phase.

    calculateOutcomeFromAnalyses(...guruAnalyses) {
        return calculateOutcomeFromAnalyses(...guruAnalyses);
    }

    getCurrentColorAnalysis(row) {
        return getCurrentColorAnalysis(row, this.currentGuruColor);
    }

    getCurrentColorSignature(row) {
        return getCurrentColorSignature(row, this.currentGuruColor);
    }

    rowHasCurrentGuruSignature(row) {
        return rowHasCurrentGuruSignature(row, this.guruSignature);
    }

    rowHasCurrentGuruSignatureInColor(row) {
        return rowHasCurrentGuruSignatureInColor(row, this.currentGuruColor, this.guruSignature);
    }

    rowHasEmptySignature(row) {
        return rowHasEmptySignature(row, this.currentGuruColor);
    }

    isCurrentMatchAvailableForAnalysis() {
        return isCurrentMatchAvailableForAnalysis(this.allRows, this.currentGuruColor, this.guruSignature, this.currentRowIndex);
    }

    isMatchAvailableForAnalysis(row) {
        return isMatchAvailableForAnalysis(row, this.currentGuruColor, this.guruSignature);
    }

    isAnalysisComplete() {
        return isAnalysisComplete(this.allRows, this.currentGuruColor);
    }

    findFirstEmptyAnalysis(startFromIndex = 0) {
        return findFirstEmptyAnalysis(this.allRows, this.currentGuruColor, this.guruSignature, startFromIndex);
    }

    findFirstDiscrepancy(startFromIndex = 0) {
        return findFirstDiscrepancy(this.allRows, this.currentGuruColor, this.guruSignature, startFromIndex);
    }

    async showCurrentRow() {
        // Update URL with current state
        this.updateURL();

        // Show sheet link
        const sheetInfoSection = document.getElementById('sheet-info');
        sheetInfoSection.innerHTML = '';
        const sheetLink = document.createElement('a');
        sheetLink.setAttribute('id', 'google-sheet-link');
        sheetLink.target = '_blank';
        sheetLink.href = `https://docs.google.com/spreadsheets/d/${this.currentData.sheetId}/edit`;
        sheetLink.title = 'Open pod in Google Sheets';
        sheetInfoSection.appendChild(sheetLink);
        
        // If pod name exists in metadata, show it prominently with sheet title below
        if (this.currentData.metadata?.podName) {
            const sheetTitle = document.createElement('h2');
            sheetTitle.setAttribute('id', 'sheet-title');
            sheetTitle.textContent = `${this.currentData.metadata.podName} ${this.currentRowIndex + 1}`;
            sheetInfoSection.insertBefore(sheetTitle, sheetLink);
            
            const subTitle = document.createElement('small');
            subTitle.setAttribute('id', 'full-sheet-title');
            subTitle.setAttribute('class', 'small-text')
            subTitle.textContent = this.currentData.title;
            sheetLink.appendChild(subTitle);
        } else {
            const sheetTitle = document.createElement('h2');
            sheetTitle.setAttribute('id', 'sheet-title');
            sheetTitle.textContent = this.currentData.title;
            sheetLink.appendChild(sheetTitle);
        }

        if (this.currentRowIndex >= this.allRows.length || this.currentRowIndex < 0) {
            this.showMatchTableModal();
            return;
        }

        const currentRow = this.allRows[this.currentRowIndex];
        
        // Update progress info
        document.getElementById('current-row-info').textContent = 
            `Match ${this.currentRowIndex + 1} of ${this.allRows.length}`;
        this.updateGuruColorDisplay();

        // Load card images for both players
        const cards1Loaded = this.loadPlayerCards('player1', currentRow.player1);
        const cards2Loaded = this.loadPlayerCards('player2', currentRow.player2);

        // Update current outcome display
        const analysisElement = document.getElementById('current-analysis-value');
        let analysisValue = null;
        
        if (currentRow.outcomeValue) {
            const outcomeValue = currentRow.outcomeValue.toLowerCase().trim();
            
            // Handle discrepancy values specially
            if (outcomeValue === 'discrepancy') {
                analysisElement.textContent = 'Discrepancy';
                analysisElement.className = 'scoring-value discrepancy';
                // Don't highlight any button for discrepancy
            } else if (outcomeValue === 'incomplete') {
                analysisElement.textContent = 'Incomplete';
                analysisElement.className = 'scoring-value';
                // Don't highlight any button for incomplete
            } else {
                // Try to parse as numeric value
                const numValue = parseFloat(currentRow.outcomeValue);
                if (!isNaN(numValue)) {
                    analysisValue = numValue;
                    analysisElement.className = 'scoring-value';
                    
                    // No current guru analysis yet, show simple display
                    if (numValue === 1.0) {
                        analysisElement.textContent = 'Win (1.0)';
                    } else if (numValue === 0.5) {
                        analysisElement.textContent = 'Tie (0.5)';
                    } else if (numValue === 0.0) {
                        analysisElement.textContent = 'Loss (0.0)';
                    } else {
                        analysisElement.textContent = `Custom (${numValue})`;
                    }
                } else {
                    // Show raw outcome value for any other text
                    analysisElement.textContent = currentRow.outcomeValue;
                    analysisElement.className = 'scoring-value';
                }
            }
        } else {
            analysisElement.textContent = 'Not set';
            analysisElement.className = 'scoring-value';
        }

        // Show current guru's analysis with other gurus' analyses
        analysisElement.innerHTML = await this.buildAnalysisDisplayWithOthers(currentRow, currentRow.outcomeValue || '');

        // Check if this row is claimed by another guru
        const currentRowSignature = this.getCurrentColorSignature(currentRow);

        const isRowClaimedByAnotherGuru = currentRowSignature && currentRowSignature.trim() !== '' && currentRowSignature !== this.guruSignature;
        const isRowUnclaimed = !currentRowSignature || currentRowSignature.trim() === '';
        const isRowOwnedByCurrentUser = currentRowSignature === this.guruSignature;

        // Show/hide scoring buttons based on row ownership
        const scoringButtons = document.querySelectorAll('.scoring-btn');
        const claimedMessage = document.getElementById('claimed-message');
        const claimButton = document.getElementById('claim-button');
        const claimDeckButton = document.getElementById('claim-deck-button');
        const unclaimButton = document.getElementById('unclaim-button');
        const clearButton = document.getElementById('clear-result-button');
        
        if (isRowClaimedByAnotherGuru) {
            // Hide scoring buttons, claim button, and unclaim button, show claimed message
            scoringButtons.forEach(btn => btn.style.display = 'none');
            if (claimButton) claimButton.style.display = 'none';
            if (claimDeckButton) claimDeckButton.style.display = 'none';
            if (unclaimButton) unclaimButton.style.display = 'none';
            if (clearButton) clearButton.style.display = 'none';
            
            // Hide Next Deck button
            const nextDeckBtn = document.getElementById('next-deck-btn');
            if (nextDeckBtn) nextDeckBtn.style.display = 'none';
            
            // Get the current analysis value for the claimed row
            const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
            const analysisText = currentAnalysis && currentAnalysis.trim() !== '' ? 
                ` - Analysis: ${this.formatAnalysisValue(currentAnalysis)}` : '';
            
            if (claimedMessage) {
                claimedMessage.style.display = 'block';
                claimedMessage.textContent = `Claimed by ${currentRowSignature}${analysisText}`;
            } else {
                // Create claimed message element if it doesn't exist
                const newClaimedMessage = document.createElement('div');
                newClaimedMessage.id = 'claimed-message';
                newClaimedMessage.className = 'claimed-message';
                newClaimedMessage.textContent = `Claimed by ${currentRowSignature}${analysisText}`;
                
                // Insert after the scoring buttons container
                const scoringContainer = document.querySelector('.scoring-buttons');
                if (scoringContainer) {
                    scoringContainer.insertAdjacentElement('afterend', newClaimedMessage);
                }
            }
        } else if (isRowUnclaimed) {
            // Hide scoring buttons, claimed message, and unclaim button, show claim button and claim deck button
            scoringButtons.forEach(btn => btn.style.display = 'none');
            if (claimedMessage) claimedMessage.style.display = 'none';
            if (unclaimButton) unclaimButton.style.display = 'none';
            if (clearButton) clearButton.style.display = 'none';

            // --- Claim Match Button ---
            let claimBtn = claimButton;
            if (claimBtn) {
                claimBtn.style.display = 'block';
                claimBtn.disabled = false;
                claimBtn.textContent = 'Claim Match';
            } else {
                claimBtn = document.createElement('button');
                claimBtn.id = 'claim-button';
                claimBtn.className = 'claim-btn primary-btn';
                claimBtn.textContent = 'Claim Match';
                claimBtn.addEventListener('click', () => this.claimRow());
                const scoringContainer = document.querySelector('.scoring-buttons');
                if (scoringContainer) {
                    scoringContainer.insertAdjacentElement('afterend', claimBtn);
                }
            }

            // --- Claim Deck Button ---
            let claimDeckBtn = document.getElementById('claim-deck-button');
            if (!claimDeckBtn) {
                claimDeckBtn = document.createElement('button');
                claimDeckBtn.id = 'claim-deck-button';
                claimDeckBtn.className = 'claim-btn primary-btn';
                
                // Set initial button text with deck stats
                const deckStats = this.getDeckStats();
                claimDeckBtn.textContent = `Claim Deck (${deckStats.unclaimedMatches}/${deckStats.totalMatches})`;
                
                claimDeckBtn.addEventListener('click', async () => {
                    claimDeckBtn.disabled = true;
                    claimDeckBtn.innerHTML = '<span class="spinner"></span> Claiming...';
                    await this.claimDeckRows();
                    claimDeckBtn.disabled = false;
                    // Update button text after claiming
                    const updatedStats = this.getDeckStats();
                    claimDeckBtn.textContent = `Claim Deck (${updatedStats.unclaimedMatches}/${updatedStats.totalMatches})`;
                });
                if (claimBtn && claimBtn.nextSibling) {
                    claimBtn.parentNode.insertBefore(claimDeckBtn, claimBtn.nextSibling);
                } else if (claimBtn) {
                    claimBtn.parentNode.appendChild(claimDeckBtn);
                }
            } else {
                // Update existing button text with current deck stats
                const deckStats = this.getDeckStats();
                claimDeckBtn.textContent = `Claim Deck (${deckStats.unclaimedMatches}/${deckStats.totalMatches})`;
                claimDeckBtn.style.display = 'inline-block';
            }

            // --- Next Deck Button ---
            const nextDeckBtn = document.getElementById('next-deck-btn');
            if (nextDeckBtn) {
                nextDeckBtn.style.display = 'inline-block';
            }
        } else if (isRowOwnedByCurrentUser) {
            // Show scoring buttons, hide claimed message and claim/claim deck buttons
            scoringButtons.forEach(btn => btn.style.display = '');
            if (claimedMessage) claimedMessage.style.display = 'none';
            if (claimButton) claimButton.style.display = 'none';
            if (claimDeckButton) claimDeckButton.style.display = 'none';
            
            // Hide Next Deck button
            const nextDeckBtn = document.getElementById('next-deck-btn');
            if (nextDeckBtn) nextDeckBtn.style.display = 'none';

            // Check if user has scored this match yet
            const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
            const hasUserScored = currentAnalysis && currentAnalysis.trim() !== '';

            // Manage unclaim / clear buttons
            let unclaimButton = document.getElementById('unclaim-button');
            let clearButton = document.getElementById('clear-result-button');

            if (!hasUserScored) {
                // User has claimed but not scored - show unclaim button and ensure clear button is hidden
                if (unclaimButton) {
                    unclaimButton.style.display = 'block';
                    unclaimButton.disabled = false;
                    unclaimButton.textContent = 'Unclaim Match';
                } else {
                    unclaimButton = document.createElement('button');
                    unclaimButton.id = 'unclaim-button';
                    unclaimButton.className = 'unclaim-btn secondary-btn';
                    unclaimButton.textContent = 'Unclaim Match';
                    unclaimButton.addEventListener('click', () => this.unclaimRow());
                    const skipButton = document.getElementById('skip-btn');
                    if (skipButton) {
                        skipButton.insertAdjacentElement('afterend', unclaimButton);
                    }
                }

                // Hide clear button when not scored
                if (clearButton) clearButton.style.display = 'none';
            } else {
                // User has scored - hide unclaim button and show clear button
                if (unclaimButton) unclaimButton.style.display = 'none';

                if (clearButton) {
                    clearButton.style.display = 'block';
                    clearButton.disabled = false;
                    clearButton.textContent = 'Clear My Result';
                } else {
                    clearButton = document.createElement('button');
                    clearButton.id = 'clear-result-button';
                    clearButton.className = 'clear-btn secondary-btn';
                    clearButton.textContent = 'Clear My Result';
                    clearButton.addEventListener('click', () => this.clearCurrentUserAnalysis());
                    const skipButton = document.getElementById('skip-btn');
                    if (skipButton) {
                        skipButton.insertAdjacentElement('afterend', clearButton);
                    }
                }
            }
            
            // Highlight the appropriate button based on current guru analysis value
            const currentAnalysisValue = currentAnalysis ? parseFloat(currentAnalysis) : null;
            this.highlightCurrentAnalysisButton(currentAnalysisValue);
        }

        // Update navigation buttons
        document.getElementById('prev-btn').disabled = this.currentRowIndex === 0;
        document.getElementById('next-btn').disabled = this.currentRowIndex >= this.allRows.length - 1;

        // Show/hide discrepancy button based on number of discrepancies
        const discrepancyButton = document.getElementById('discrepancy-btn');
        if (discrepancyButton) {
            if (this.numDiscrepancies > 0) {
                discrepancyButton.style.display = 'inline-block';
                discrepancyButton.textContent = `Next Discrepancy (${this.numDiscrepancies})`;
            } else {
                discrepancyButton.style.display = 'none';
            }
        }

        // Update inverse result display on mirror match button
        this.updateInverseResultDisplay();

        await cards1Loaded;
        await cards2Loaded;

        // Preload card images for adjacent matches in the background
        this.preloadCardImages();
    }

    /**
     * Claim all unclaimed matches with the same Player 1 deck as the current row
     */
    async claimDeckRows() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];
        const player1Deck = currentRow.player1;
        if (!player1Deck) return;


        // Find all rows with the same Player 1 deck (total for this deck)
        const rowsToClaim = this.allRows.filter(row => row.player1 === player1Deck);

        if (rowsToClaim.length === 0) {
            this.uiController.showStatus(`No matches found for deck "${player1Deck}".`, 'error');
            return;
        }

        // Prepare batch updates
        const updates = {
            updates: rowsToClaim.map(row => {
                const signatureColIndex = this.getCurrentGuruColIndex('signature');
                return {
                    sheetId: row.sheetId,
                    row: row.originalRowIndex + 1,
                    col: signatureColIndex + 1,
                    value: this.guruSignature,
                    expectedValue: '',
                    valueType: 'string',
                    isMergedGuruUpdate: true,
                    guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
                };
            })
        };

        try {
            this.uiController.showStatus(`Claiming ${rowsToClaim.length} matches for deck...`, 'loading');
            const result = await this.sheetsAPI.checkedUpdateSheetData(this.currentData.sheetId, updates);

            // Update local data for only those that were actually claimed
            let actuallyClaimed = 0;
            if (result && result.updatedCells) {
                rowsToClaim.forEach((row, i) => {
                    // Find the matching row in this.allRows by originalRowIndex and sheetId
                    const match = this.allRows.find(r => r.originalRowIndex === row.originalRowIndex && r.sheetId === row.sheetId);
                    if (!match) return;
                    // Find the matching row in the skipped ones
                    const skipped = result.skipped && result.skipped.find(s => s.row === row.originalRowIndex + 1);
                    if (skipped) {
                        // This row is already claimed, set the signature to the value from skipped
                        setColourSignature(match, this.currentGuruColor, skipped.currentValue);
                    }
                    else {
                        // Successfully claimed this row, set the signature to user's guru signature
                        setColourSignature(match, this.currentGuruColor, this.guruSignature);
                        actuallyClaimed++;
                    }
                });
            }

            this.uiController.showStatus(`Claimed ${actuallyClaimed} of ${rowsToClaim.length} matches for this deck.`, 'success');
            console.log(`🎯 Claimed ${actuallyClaimed} matches for deck "${player1Deck}" (${rowsToClaim.length} total)`);
            this.showCurrentRow();

        } catch (error) {
            console.error('Error claiming deck matches:', error);
            this.uiController.showStatus(`Error claiming deck matches: ${error.message}`, 'error');
        }
    }

    /**
     * Preload card images for adjacent matches and the next empty analysis
     * This improves user experience by having images ready when user navigates
     */
    preloadCardImages() {
        const decksToPreload = [];
        const rowsToPreload = new Set();
        
        // 1. Preload next empty analysis starting from after current row
        const nextEmptyIndex = this.findFirstEmptyAnalysis(this.currentRowIndex + 1);
        if (nextEmptyIndex != null) {
            rowsToPreload.add(nextEmptyIndex);
        }

        // 2. Preload next match (currentRowIndex + 1)
        const nextRowIndex = this.currentRowIndex + 1;
        if (nextRowIndex >= 0 && nextRowIndex < this.allRows.length) {
            rowsToPreload.add(nextRowIndex);
        }
        
        // 3. Preload previous match (currentRowIndex - 1)
        const prevRowIndex = this.currentRowIndex - 1;
        if (prevRowIndex >= 0 && prevRowIndex < this.allRows.length) {
            rowsToPreload.add(prevRowIndex);
        }
        
        
        // Collect all decks from the rows we want to preload
        rowsToPreload.forEach(rowIndex => {
            const row = this.allRows[rowIndex];
            if (row) {
                if (row.player1 && row.player1.trim()) {
                    decksToPreload.push(row.player1.trim());
                }
                if (row.player2 && row.player2.trim()) {
                    decksToPreload.push(row.player2.trim());
                }
            }
        });
        
        if (decksToPreload.length > 0) {
            // Start preloading in the background with slower pace to not interfere
            this.scryfallAPI.preloadCards(decksToPreload, {
                delay: 300,  // Slower preloading to be less aggressive
                silent: true // Don't spam console logs
            });
            
            console.log(`🔄 Started preloading cards for ${rowsToPreload.size} matches (rows: ${Array.from(rowsToPreload).map(i => i + 1).join(', ')})`);
        }
    }

    async loadPlayerCards(playerId, deckString) {
        const cardsContainer = document.getElementById(`${playerId}-cards`);
        const cardSlots = cardsContainer.querySelectorAll('.card-slot');

        // Parse deck string to get card names for loading state
        const cardNames = this.scryfallAPI.parseDeckString(deckString);

        // Reset all slots to loading state with card names
        cardSlots.forEach((slot, index) => {
            if (index < cardNames.length) {
                slot.innerHTML = `<div class="card-loading">${cardNames[index]}</div>`;
            } else {
                slot.innerHTML = '<div class="card-loading">Loading...</div>';
            }
        });

        // Add deck information if available
        this.displayDeckInfo(playerId, deckString);

        try {
            const deckImages = await this.scryfallAPI.getDeckImages(deckString);
            
            // Display cards in slots
            for (let i = 0; i < Math.min(deckImages.length, cardSlots.length); i++) {
                const cardData = deckImages[i];
                const slot = cardSlots[i];
                
                if (cardData.image) {
                    // Create Scryfall search URL with quoted card name for exact match
                    const scryfallUrl = this.scryfallAPI.getCardUrl(cardData.cardName);
                    
                    // Use the loaded Image object directly - wrap in link to Scryfall
                    const link = document.createElement('a');
                    link.href = scryfallUrl;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.className = 'card-link';
                    link.title = `Click to view ${cardData.cardName} on Scryfall`;
                    
                    // Clone the cached image to avoid moving it from cache
                    const displayImage = cardData.image.cloneNode();
                    displayImage.alt = cardData.cardName;
                    
                    link.appendChild(displayImage);
                    slot.innerHTML = '';
                    slot.appendChild(link);
                } else {
                    // Show card name as fallback - also linkable, but with non-exact matching
                    const scryfallUrl = this.scryfallAPI.getCardUrl(cardData.cardName, false);
                    slot.innerHTML = `<a href="${scryfallUrl}" target="_blank" rel="noopener noreferrer" class="card-link">
                        <div class="card-error">${cardData.cardName}</div>
                    </a>`;
                }
            }

            // Clear any remaining slots
            for (let i = deckImages.length; i < cardSlots.length; i++) {
                cardSlots[i].innerHTML = '<div class="card-loading">-</div>';
            }

        } catch (error) {
            console.error(`Error loading cards for ${playerId}:`, error);
            
            // Show error in all slots
            cardSlots.forEach(slot => {
                slot.innerHTML = '<div class="card-error">Failed to load</div>';
            });
        }
    }

    async setAnalysis(value) {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];
        
        try {
            this.uiController.showStatus('Saving guru analysis...', 'loading');

            // Use helper to get analysis column index
            const analysisColIndex = this.getCurrentGuruColIndex('analysis');
            console.log('🎯 Updating cell:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                analysisColIndex,
                guruColor: this.currentGuruColor,
                value: value
            });

            // For merged guru sheet, we need to route to the correct individual sheet
            const updates = {
                updates: [{
                    sheetId: currentRow.sheetId,
                    row: currentRow.originalRowIndex + 1, // +1 because sheets are 1-indexed
                    col: analysisColIndex + 1, // +1 because sheets are 1-indexed
                    value: value.toString(),
                    valueType: 'number', // Explicitly specify this is a number
                    isMergedGuruUpdate: true,
                    guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
                }]
            };

            await this.sheetsAPI.updateSheetData(this.currentData.sheetId, updates);
            
            // Update the specific guru analysis in the local data
            setColourAnalysis(currentRow, this.currentGuruColor, value.toString());
            
            // Calculate and update the outcome value based on all guru analyses
            const newOutcome = this.calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));
            currentRow.outcomeValue = newOutcome;
            
            // Update button highlighting immediately based on the new analysis value
            this.highlightCurrentAnalysisButton(value);
            // Update outcome display
            const analysisElement = document.getElementById('current-analysis-value');
            if (analysisElement) {
                analysisElement.innerHTML = await this.buildAnalysisDisplayWithOthers(currentRow, newOutcome);
            }
            
            this.uiController.showStatus(`Analysis saved: ${this.getAnalysisLabel(value)}`, 'success');
            
            // Check if analysis is now complete
            if (this.isAnalysisComplete()) {
                this.showCompletionMessage();
                return;
            }
            
            // Reload data in the background to get fresh updates without moving to next row
            this.reloadAllDataInBackground();
            
        } catch (error) {
            console.error('Error saving analysis:', error);
            this.uiController.showStatus(`Error saving analysis: ${error.message}`, 'error');
        }
    }

    getAnalysisLabel(value) {
        return getAnalysisLabel(value);
    }

    async claimRow() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];
        

        // Show spinner on claim button
        const claimButton = document.getElementById('claim-button');
        const originalButtonText = claimButton ? claimButton.textContent : 'Claim Match';
        if (claimButton) {
            claimButton.disabled = true;
            claimButton.innerHTML = '<span class="spinner"></span> Claiming...';
        }

        try {
            this.uiController.showStatus('Claiming match...', 'loading');

            // Use helper to get signature column index
            const signatureColIndex = this.getCurrentGuruColIndex('signature');
            console.log('🎯 Claiming match:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                signatureColIndex,
                guruColor: this.currentGuruColor,
                userSignature: this.guruSignature
            });

            // Use checked update to atomically claim the match only if signature is still empty
            const updates = {
                updates: [{
                    sheetId: currentRow.sheetId,
                    row: currentRow.originalRowIndex + 1, // +1 because sheets are 1-indexed
                    col: signatureColIndex + 1, // +1 because sheets are 1-indexed
                    value: this.guruSignature,
                    expectedValue: '', // Only update if current value is empty
                    valueType: 'string',
                    isMergedGuruUpdate: true,
                    guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
                }]
            };

            const result = await this.sheetsAPI.checkedUpdateSheetData(this.currentData.sheetId, updates);

            if (result && result.skippedCells > 0) {
                // Someone else claimed the match first
                this.uiController.showStatus('Match was already claimed by someone else', 'info');
                // Refresh the display to show the updated state
                await this.reloadAllDataInBackground();
                return;
            }

            // Update local data with the new signature
            setColourSignature(currentRow, this.currentGuruColor, this.guruSignature);

            this.uiController.showStatus('Match claimed successfully!', 'success');

            // Refresh the display to show scoring buttons now that the match is claimed
            await this.showCurrentRow();

        } catch (error) {
            console.error('Error claiming match:', error);

            // Reset claim button on error
            if (claimButton) {
                claimButton.disabled = false;
                claimButton.textContent = originalButtonText;
            }
            this.uiController.showStatus(`Error claiming match: ${error.message}`, 'error');
        }
    }

    async unclaimRow() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];
        

        // Verify that the current user owns this match
        const currentRowSignature = this.getCurrentColorSignature(currentRow);
        if (currentRowSignature !== this.guruSignature) {
            this.uiController.showStatus('You can only unclaim matches that you have claimed.', 'error');
            return;
        }

        // Check if user has already scored this match
        const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
        if (currentAnalysis && currentAnalysis.trim() !== '') {
            this.uiController.showStatus('Cannot unclaim a match that has already been scored.', 'error');
            return;
        }

        // Show spinner on unclaim button
        const unclaimButton = document.getElementById('unclaim-button');
        const originalButtonText = unclaimButton ? unclaimButton.textContent : 'Unclaim Match';
        if (unclaimButton) {
            unclaimButton.disabled = true;
            unclaimButton.innerHTML = '<span class="spinner"></span> Unclaiming...';
        }

        try {
            this.uiController.showStatus('Unclaiming match...', 'loading');

            // Use helper to get signature column index
            const signatureColIndex = this.getCurrentGuruColIndex('signature');
            console.log('🎯 Unclaiming match:', {
                sheetTitle: currentRow.title,
                originalRowIndex: currentRow.originalRowIndex,
                filteredRowIndex: currentRow.rowIndex,
                signatureColIndex,
                guruColor: this.currentGuruColor,
                userSignature: this.guruSignature
            });

            // Clear the signature using clearCell helper
            const updateObj = {
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex + 1, // +1 because sheets are 1-indexed
                col: signatureColIndex + 1, // +1 because sheets are 1-indexed
                isMergedGuruUpdate: true,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            };

            await this.sheetsAPI.clearCell(this.currentData.sheetId, updateObj);
            
            // Update local data to clear the signature
            setColourSignature(currentRow, this.currentGuruColor, '');
            
            this.uiController.showStatus('Match unclaimed successfully!', 'success');
            
            // Refresh the display to show claim button now that the match is unclaimed
            await this.showCurrentRow();
            
        } catch (error) {
            console.error('Error unclaiming match:', error);
            
            // Reset unclaim button on error
            if (unclaimButton) {
                unclaimButton.disabled = false;
                unclaimButton.textContent = originalButtonText;
            }
            
            this.uiController.showStatus(`Error unclaiming match: ${error.message}`, 'error');
        }
    }

    /**
     * Clear the current user's analysis for the current row (when they've already scored)
     */
    async clearCurrentUserAnalysis() {
        if (this.currentRowIndex >= this.allRows.length) return;

        const currentRow = this.allRows[this.currentRowIndex];


        // Verify that the current user owns this match
        const currentRowSignature = this.getCurrentColorSignature(currentRow);
        if (currentRowSignature !== this.guruSignature) {
            this.uiController.showStatus('You can only clear results for matches you own.', 'error');
            return;
        }

        // Check if user actually has an analysis to clear
        const currentAnalysis = this.getCurrentColorAnalysis(currentRow);
        if (!currentAnalysis || currentAnalysis.trim() === '') {
            this.uiController.showStatus('No analysis to clear for this match.', 'info');
            return;
        }

        // Disable the clear button and show spinner
        const clearButton = document.getElementById('clear-result-button');
        const originalText = clearButton ? clearButton.textContent : 'Clear My Result';
        if (clearButton) {
            clearButton.disabled = true;
            clearButton.innerHTML = '<span class="spinner"></span> Clearing...';
        }

        try {
            this.uiController.showStatus('Clearing your analysis...', 'loading');

            // Use helper to get analysis column index
            const analysisColIndex = this.getCurrentGuruColIndex('analysis');

            const updateObj = {
                sheetId: currentRow.sheetId,
                row: currentRow.originalRowIndex + 1,
                col: analysisColIndex + 1,
                // value not needed for clearCell; we signal intent via row/col
                isMergedGuruUpdate: true,
                guruSheetIds: this.currentData.sheets.find(s => s.title === 'Merged Gurus')?.guruSheetIds
            };

            await this.sheetsAPI.clearCell(this.currentData.sheetId, updateObj);

            // Update local data to clear the analysis for the current guru
            setColourAnalysis(currentRow, this.currentGuruColor, '');

            // Recalculate outcome
            const oldOutcome = currentRow.outcomeValue;
            currentRow.outcomeValue = this.calculateOutcomeFromAnalyses(...getGuruAnalysisValues(currentRow));

            // Update the number of discrepancies
            if (oldOutcome === 'discrepancy' && currentRow.outcomeValue !== 'discrepancy'){
                this.numDiscrepancies--;
            } else if (oldOutcome !== 'discrepancy' && currentRow.outcomeValue === 'discrepancy'){
                this.numDiscrepancies++;
            }

            // Reload data in the background to get fresh updates without moving to next row
            this.reloadAllDataInBackground();

            this.uiController.showStatus('Your analysis was cleared.', 'success');

            // Hide clear button after clearing
            if (clearButton) clearButton.style.display = 'none';

            // Update UI for current row
            await this.showCurrentRow();

        } catch (error) {
            console.error('Error clearing analysis:', error);
            if (clearButton) {
                clearButton.disabled = false;
                clearButton.textContent = originalText;
            }
            this.uiController.showStatus(`Error clearing analysis: ${error.message}`, 'error');
        }
    }

    async reloadAllData() {
        try {
            // Get fresh data for the entire sheet
            const freshSheetData = await this.sheetsAPI.getSheetData(this.currentData.sheetId);
            
            // Store the current row index to restore position
            const currentRowIndex = this.currentRowIndex;
            
            // Reload all data (this will rebuild this.allRows with fresh data)
            await this.loadData(freshSheetData);
            
            // Restore position to the same row (or closest valid row)
            this.currentRowIndex = Math.min(currentRowIndex, this.allRows.length - 1);

            // Show the current row with fresh data
            await this.showCurrentRow();
            
            console.log('🔄 Reloaded all data, restored to row:', this.currentRowIndex + 1);
            
        } catch (error) {
            console.warn('Error reloading all data:', error);
            // Don't throw - this is a nice-to-have feature
        }
    }

    async reloadAllDataInBackground() {
        // Run the reload in the background without blocking the UI
        try {
            console.log('🔄 Starting background data refresh...');
            
            // Get fresh data for the entire sheet
            const freshSheetData = await this.sheetsAPI.getSheetData(this.currentData.sheetId);
            
            // Store the current row info to find it again after reload
            const currentRow = this.allRows[this.currentRowIndex];
            const currentRowIdentifier = {
                sheetId: currentRow.sheetId,
                originalRowIndex: currentRow.originalRowIndex,
                player1: currentRow.player1,
                player2: currentRow.player2
            };
            
            // Rebuild data with fresh information
            this.currentData = freshSheetData;
            
            this.allRows = [];
            
            // Process all sheets and collect rows that need analysis
            if (freshSheetData.sheets && Array.isArray(freshSheetData.sheets)) {
                freshSheetData.sheets.forEach((sheet, sheetIndex) => {
                    if (sheet.values && sheet.values.length > 1) {
                        this.processSheet(sheet, sheetIndex);
                    }
                });
            }
            
            // Find the current row in the fresh data
            let newRowIndex = 0;
            for (let i = 0; i < this.allRows.length; i++) {
                const row = this.allRows[i];
                if (row.sheetId === currentRowIdentifier.sheetId &&
                    row.originalRowIndex === currentRowIdentifier.originalRowIndex &&
                    row.player1 === currentRowIdentifier.player1 &&
                    row.player2 === currentRowIdentifier.player2) {
                    newRowIndex = i;
                    break;
                }
            }
            
            // Update current position to the refreshed row
            this.currentRowIndex = newRowIndex;
            
            // Silently update the current row display with fresh data
            await this.showCurrentRow();
            
            console.log('🔄 Background data refresh completed successfully');
            
        } catch (error) {
            console.warn('Background data refresh failed:', error);
            // Don't show error to user since this is background operation
        }
    }

    buildDiscrepancyDisplay(currentRow) {
        // Collect other guru analyses (exclude the current guru's analysis)
        const otherAnalyses = [];
        
        // Show analyses from other gurus based on current guru color
        for (const colour of GURU_COLORS) {
            const analysis = getCurrentColorAnalysis(currentRow, colour);
            if (this.currentGuruColor !== colour && analysis) {
                otherAnalyses.push({ name: colourLabel(colour), value: analysis });
            }
        }
        
        // Build the display HTML with proper structure
        let html = '<div class="discrepancy-content">';
        html += '<div class="discrepancy-header">Discrepancy</div>';
        html += '</div>';
        
        if (otherAnalyses.length > 0) {
            html += '<div class="other-analyses">';
            otherAnalyses.forEach(analysis => {
                const displayValue = this.formatAnalysisValue(analysis.value);
                const cssClass = this.getAnalysisClass(analysis.value);
                html += `<div class="other-analysis ${cssClass}">
                    <div class="guru-name">${analysis.name}</div>
                    <div class="analysis-value">${displayValue}</div>
                </div>`;
            });
            html += '</div>';
        }
        
        return html;
    }

    async buildAnalysisDisplayWithOthers(currentRow, outcomeValue = '') {
        // Get current guru's analysis
        const currentGuruAnalysis = this.getCurrentColorAnalysis(currentRow);
        
        // Collect all guru analyses (including current guru)
        const allAnalyses = [];
        
        // Add current guru's analysis first
        const currentGuruName = colourLabel(this.currentGuruColor);
        allAnalyses.push({ 
            name: currentGuruName, 
            value: currentGuruAnalysis, 
            isCurrent: true 
        });

        const showOtherGurus = !this.isMatchAvailableForAnalysis(currentRow);
        
        // Add other guru analyses with their signatures
        for (const colour of GURU_COLORS) {
            if (this.currentGuruColor === colour) {
                continue;
            }
            const signatureValue = getCurrentColorSignature(currentRow, colour);
            const signature = signatureValue && signatureValue.trim() !== '' ? signatureValue : null;
            allAnalyses.push({
                name: colourLabel(colour),
                signature: signature,
                value: getCurrentColorAnalysis(currentRow, colour),
                isCurrent: false
            });
        }
        
        // Build the simple list HTML
        let html = '<div class="analysis-list">';
        
        // Show outcome header for all cases
        const outcomeDisplay = this.getOutcomeDisplayName(outcomeValue);
        html += `<div class="outcome-header">${outcomeDisplay}</div>`;
        
        html += '<ul class="guru-analyses-list">';
        
        allAnalyses.forEach(analysis => {
            const displayValue = showOtherGurus || !analysis.value ? this.formatAnalysisValue(analysis.value) : '███';
            const cssClass = showOtherGurus ? this.getAnalysisClass(analysis.value) : 'other';
            const prefix = analysis.isCurrent ? 'You' : analysis.name;
            
            // Add tooltip span if signature is available
            let labelHtml;
            if (analysis.signature) {
                labelHtml = `<span class="guru-analysis-label guru-signature">
                    ${prefix}:
                    <span class="guru-signature-tooltip">${analysis.signature}</span>
                </span>`;
            } else {
                labelHtml = `<span class="guru-analysis-label">${prefix}:</span>`;
            }
            
            html += `<li class="guru-analysis-item">
                ${labelHtml}
                <span class="analysis-result ${cssClass}">${displayValue}</span>
            </li>`;
        });
        
        html += '</ul>';
        
        html += '</div>';
        
        // Manage Discord thread link/button
        let threadUrl = null;
        
        // Try to get thread URL if hub is available
        if (this.hub) {
            try {
                const rowId = currentRow.rowIndex || this.currentRowIndex + 1;
                threadUrl = await this.hub.getThreadById(rowId);
            } catch (error) {
                console.warn('Failed to fetch thread link:', error);
            }
        }
        
        if (threadUrl) {
            // Show Discord thread link icon (blurple)
            html += `<a href="${threadUrl}" target="_blank" rel="noopener noreferrer" class="discord-icon-link" title="Open Guru Match Help post">
                <img src="images/Discord-Symbol-Blurple.svg" alt="Discord" />
            </a>`;
        } else {
            // Show button to create thread (black icon)
            html += `<button class="discord-icon-button create-thread-btn" data-row-index="${this.currentRowIndex}" title="Create Guru Match Help post">
                <img src="images/Discord-Symbol-Black.svg" alt="Discord" />
            </button>`;
        }
        
        return html;
    }

    /**
     * Get deck statistics for the current row's Player 1 deck
     * @returns {Object} Object with totalMatches and unclaimedMatches
     */
    getDeckStats() {
        return getDeckStats(this.allRows, this.currentGuruColor, this.currentRowIndex);
    }

    /**
     * Returns the column index for the current guru color and type ('analysis' or 'signature')
     */
    getCurrentGuruColIndex(type = 'analysis') {
        return getCurrentGuruColIndex(this.currentGuruColor, this.columnIndex, type);
    }

    /**
     * Returns the color that the current guru has claimed in a particular row, or null
     * if that row does not have the current guru's signature. 
     */
    getGuruColorInRow(row) {
        return getGuruColorInRow(row, this.guruSignature);
    }
    
    getOutcomeDisplayName(outcomeValue) {
        return getOutcomeDisplayName(outcomeValue);
    }

    getAnalysisClass(value) {
        return getAnalysisClass(value);
    }

    formatAnalysisValue(value) {
        return formatAnalysisValue(value);
    }

    highlightCurrentAnalysisButton(outcomeValue) {
        // Remove current-analysis class from all buttons
        const allButtons = document.querySelectorAll('.scoring-btn');
        allButtons.forEach(btn => btn.classList.remove('current-analysis'));

        // Only highlight buttons for numeric outcome values
        if (typeof outcomeValue === 'number') {
            if (outcomeValue === 1.0) {
                document.getElementById('win-btn').classList.add('current-analysis');
            } else if (outcomeValue === 0.5) {
                document.getElementById('tie-btn').classList.add('current-analysis');
            } else if (outcomeValue === 0.0) {
                document.getElementById('loss-btn').classList.add('current-analysis');
            }
        }
        // For text values like 'discrepancy' or 'incomplete', no button gets highlighted
    }

    async nextRow() {
        if (this.currentRowIndex < this.allRows.length - 1) {
            this.currentRowIndex++;
            await this.showCurrentRow();
        }
    }

    async previousRow() {
        if (this.currentRowIndex > 0) {
            this.currentRowIndex--;
            await this.showCurrentRow();
        }
    }

    async skipToNextIncomplete() {
        // Find the next empty starting from after current row
        const nextIncompleteIndex = this.findFirstEmptyAnalysis(this.currentRowIndex + 1);
        
        // Check if we found a row after the current one
        if (nextIncompleteIndex != null && nextIncompleteIndex != this.currentRowIndex) {
            this.currentRowIndex = nextIncompleteIndex;
            await this.showCurrentRow();
        } else {
            // No more incomplete rows found after current, show completion message
            this.showCompletionMessage();
        }
    }

    async skipToNextDiscrepancy() {
        // Find the next row with discrepancy starting from after current row
        const targetIndex = this.findFirstDiscrepancy(this.currentRowIndex + 1);
        if (targetIndex >= 0) {
            this.currentRowIndex = targetIndex;
        }
        // If the row we jump to has a discrepancy but the guru is in a different color,
        // change to that color
        const targetRow = this.allRows[this.currentRowIndex];
        if (this.rowHasDiscrepancy(targetRow)){
            const color = this.getGuruColorInRow(targetRow);
            console.log(color)
            if (color){
                this.currentGuruColor = color;
            }
        }
        await this.showCurrentRow();
    }

    /**
     * Find the first unclaimed match with a different P1 deck from the current one
     * @returns {number} - Index of the next deck match, or current index if none found
     */
    findNextDeck() {
        return findNextDeck(this.allRows, this.currentGuruColor, this.currentRowIndex);
    }

    async skipToNextDeck() {
        const nextDeckIndex = this.findNextDeck();
        if (nextDeckIndex !== this.currentRowIndex) {
            this.currentRowIndex = nextDeckIndex;
            await this.showCurrentRow();
        } else {
            this.uiController.showStatus('No other unclaimed decks found', 'info');
        }
    }

    /**
     * Find the index of the mirror match (inverse) for a given row
     * @param {number} rowIndex - Index of the row to find the mirror for
     * @returns {number} - Index of the mirror match, or -1 if not found
     */
    findMirrorMatchIndex(rowIndex) {
        return findMirrorMatchIndex(this.allRows, rowIndex);
    }

    /**
     * Update the display of the inverse match result on the mirror match button
     */
    updateInverseResultDisplay() {
        const mirrorMatchBtn = document.getElementById('mirror-match-btn');
        if (!mirrorMatchBtn) return;

        // Get current row's outcome value
        const currentRow = this.allRows[this.currentRowIndex];
        const currentOutcome = currentRow.outcomeValue;


        // Find the mirror match
        const mirrorIndex = this.findMirrorMatchIndex(this.currentRowIndex);
        // Get inverse match outcome
        const inverseRow = this.allRows[mirrorIndex];
        const inverseOutcome = inverseRow?.outcomeValue;

        // Only show if inverse match exists and has a valid result, and I'm not about to solve it
        if (
            mirrorIndex >= 0 &&
            (!inverseOutcome ||
                inverseOutcome.trim() === '' ||
                inverseOutcome.toLowerCase() === 'incomplete' ||
                inverseOutcome.toLowerCase() === 'discrepancy') ||
            this.isCurrentMatchAvailableForAnalysis()
        ) {
            // Reset button to just arrow if inverse outcome is invalid
            mirrorMatchBtn.textContent = '↕';
            mirrorMatchBtn.removeAttribute('data-outcome');
            mirrorMatchBtn.className = 'mirror-match-btn';
            mirrorMatchBtn.title = 'Jump to mirror match';
            return;
        }

        // Convert outcome to letter (W/T/L) - inverted to show what the P1 deck does going second
        const outcomeToLetter = (outcome) => {
            const numValue = parseFloat(outcome);
            if (!isNaN(numValue)) {
                if (numValue === 0.0) return 'W';
                if (numValue === 0.5) return 'T';
                if (numValue === 1.0) return 'L';
            }
            return '?';
        };

        const inverseLetter = outcomeToLetter(inverseOutcome);
        
        // Check if this is a suspected error
        // Error condition: at least one is Loss AND neither is Win
        const currentNumValue = parseFloat(currentOutcome);
        const inverseNumValue = parseFloat(inverseOutcome);
        const isSuspectedError = 
            !isNaN(currentNumValue) && !isNaN(inverseNumValue) &&
            (currentNumValue === 0.0 || inverseNumValue === 0.0) && // At least one is Loss
            (currentNumValue !== 1.0 && inverseNumValue !== 1.0);   // Neither is Win

        // Update button content to show arrow and set outcome letter as data attribute
        mirrorMatchBtn.textContent = '↕';
        mirrorMatchBtn.setAttribute('data-outcome', inverseLetter);
        
        // Update button styling based on error status
        mirrorMatchBtn.className = 'mirror-match-btn';
        mirrorMatchBtn.classList.add('has-outcome');
        if (isSuspectedError) {
            mirrorMatchBtn.classList.add('inverse-error');
        }
        
        mirrorMatchBtn.title = `Jump to mirror match`;
    }

    async skipToMirrorMatch() {
        // Jump to the match where player1 and player2 are swapped
        const mirrorIndex = this.findMirrorMatchIndex(this.currentRowIndex);
        
        if (mirrorIndex !== -1) {
            this.currentRowIndex = mirrorIndex;
            await this.showCurrentRow();
        } else {
            this.uiController.showStatus('No mirror match found for this game.', 'info');
        }
    }

    showCompletionMessage() {
        this.uiController.showStatus('All rows analysed! Great work!', 'success');
    }

    showNoDataMessage() {
        const analysisInterface = document.getElementById('guru-analysis-interface');
        analysisInterface.innerHTML = `
            <div class="empty-state">
                <h3>No Analysis Data Found</h3>
                <p>No rows found with the required columns:</p>
                <ul>
                    <li>Player 1</li>
                    <li>Player 2</li>
                    <li>Guru Analysis columns (Red, Blue, Green)</li>
                </ul>
                <p>Please check that your sheets have the correct column headers and data.</p>
            </div>
        `;
    }

    showDeckNotesEditor(notesData) {
        this.updateURL();
        if (!this.deckNotesEditor) {
            // Create a new instance if it doesn't exist
            this.deckNotesEditor = new DeckNotesEditor({
                analysisInterface: this,
                uiController: this.uiController,
                scryfallAPI: this.scryfallAPI,
                sheetsAPI: this.sheetsAPI,
                spreadsheetID: this.currentData.sheetId,
            });
        } else {
            // Update references in case they changed
            this.deckNotesEditor.uiController = this.uiController;
            this.deckNotesEditor.scryfallAPI = this.scryfallAPI;
            this.deckNotesEditor.sheetsAPI = this.sheetsAPI;
            this.deckNotesEditor.spreadsheetID = this.currentData.sheetId;
        }
        this.deckNotesEditor.show(notesData, this.currentData.title);
    }

    calculateColorStatistics(sheetData) {
        // Find the merged guru sheet
        const mergedGuruSheet = sheetData.sheets?.find(sheet => 
            sheet.title === 'Merged Gurus'
        );

        const stats = {};
        for (const colour of GURU_COLORS) {
            stats[colour] = { claimed: 0, total: 0 };
        }

        if (!mergedGuruSheet || !mergedGuruSheet.values || mergedGuruSheet.values.length < 2) {
            return stats;
        }

        const headerRow = mergedGuruSheet.values[0];

        // Find columns
        const player1ColIndex = findColumnIndex(headerRow, ['Player 1', 'Player1']);
        const player2ColIndex = findColumnIndex(headerRow, ['Player 2', 'Player2']);
        const signatureCols = Object.fromEntries(
            GURU_COLORS.map(colour => [colour, findColumnIndex(headerRow, [`${colourLabel(colour)} Signature`])])
        );

        // Count matches for each color
        for (let rowIndex = 1; rowIndex < mergedGuruSheet.values.length; rowIndex++) {
            const row = mergedGuruSheet.values[rowIndex];
            const player1 = row[player1ColIndex] || '';
            const player2 = row[player2ColIndex] || '';

            // Only count rows that have player data (actual matches)
            if (player1.trim() || player2.trim()) {
                for (const colour of GURU_COLORS) {
                    stats[colour].total++;

                    // Check if each color is claimed
                    const colIndex = signatureCols[colour];
                    if (colIndex !== -1 && row[colIndex] && row[colIndex].trim() !== '') {
                        stats[colour].claimed++;
                    }
                }
            }
        }

        return stats;
    }

    showGuruColorSelection(sheetData) {
        // Hide the existing guru analysis interface instead of overwriting it
        const analysisInterface = document.getElementById('guru-analysis-interface');
        analysisInterface.style.display = 'none';
        
        // Create a new color selection container
        const colorSelectionContainer = document.createElement('div');
        colorSelectionContainer.id = 'color-selection-container';
        colorSelectionContainer.className = 'color-selection-container full-screen';
        
        const stats = this.calculateColorStatistics(sheetData);
        const sheetTitle = sheetData.title || 'Unknown Sheet';
        
        const colorOptions = GURU_COLORS.map(colour => {
            const label = colourLabel(colour);
            const colourStats = stats[colour];
            return `
                    <div class="color-option" id="color-${colour}">
                        <div class="color-circle ${colour}"></div>
                        <div class="color-info">
                            <h4>${label} Guru</h4>
                            <p>${colourStats.claimed} / ${colourStats.total} matches claimed</p>
                        </div>
                        <button class="select-color-btn" data-color="${colour}">Select ${label}</button>
                    </div>`;
        }).join('\n');

        colorSelectionContainer.innerHTML = `
            <div class="color-selection-screen">
                <h3>Choose Your Guru Color</h3>
                <h4 class="sheet-title">Pod: ${sheetTitle}</h4>
                <p>Your signature was not found in any existing analysis. Please select which guru color you want to use for analysis:</p>

                <div class="color-options">${colorOptions}
                </div>

                <p class="color-selection-note">You can start analysing matches by claiming unclaimed matches or work on matches already assigned to your chosen color.</p>
            </div>
        `;
        
        // Insert the color selection container after the analysis interface
        analysisInterface.parentNode.insertBefore(colorSelectionContainer, analysisInterface.nextSibling);
        
        // Add event listeners for color selection
        colorSelectionContainer.querySelectorAll('.select-color-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const selectedColor = e.target.getAttribute('data-color');
                this.selectGuruColor(selectedColor, sheetData, colorSelectionContainer);
            });
        });
    }

    async selectGuruColor(color, sheetData, colorSelectionContainer) {
        console.log(`User selected guru color: ${color}`);
        
        // Set the guru color
        this.currentGuruColor = color;
        
        // Remove the color selection container
        if (colorSelectionContainer && colorSelectionContainer.parentNode) {
            colorSelectionContainer.parentNode.removeChild(colorSelectionContainer);
        }
        
        // Show the analysis interface again
        const analysisInterface = document.getElementById('guru-analysis-interface');
        analysisInterface.style.display = '';
        
        // Ensure the sheet editor is visible before loading data
        this.uiController.showSheetEditor();
        
        // Continue with the normal data loading process, but skip guru color determination
        await this.loadData(sheetData, color);
        await this.showCurrentRow();
    }


    getTotalRows() {
        return this.allRows.length;
    }

    getCurrentProgress() {
        return {
            current: this.currentRowIndex + 1,
            total: this.allRows.length
        };
    }

    displayDeckInfo(playerId, deckString) {
        console.log('displayDeckInfo called with:', playerId, deckString);

        // Check if we have deck notes for this deck
        if (!this.deckNotesMap) {
            console.log('No deckNotesMap available');
            return;
        }
                
        if (!this.deckNotesMap.has(deckString)) {
            console.log('No deck notes found for:', deckString);
            return;
        }

        const deckInfo = this.deckNotesMap.get(deckString);
        console.log('Found deck info:', deckInfo);
        
        const infoElements = [];

        // Add goldfish clock, notes, and additional notes
        infoElements.push(`<span class="deck-clock">Clock: <span class="notes-value">${deckInfo.goldfishClock || ''}</span> <button class="edit-deck-info-btn" data-type="clock" title="Edit Clock">✎</button></span>`);
        infoElements.push(`<span class="deck-notes"><span class="notes-value">${deckInfo.notes || ''}</span> <button class="edit-deck-info-btn" data-type="notes" title="Edit Notes">✎</button></span>`);
        infoElements.push(`<hr class="deck-separator">`);
        infoElements.push(`<span class="deck-additional"><span class="notes-value">${deckInfo.additionalNotes || ''}</span> <button class="edit-deck-info-btn" data-type="additionalNotes" title="Edit Additional Notes">✎</button></span>`);


        const deckInfoDiv = document.getElementById(`${playerId}-deck-info`);
        deckInfoDiv.innerHTML = infoElements.join(' ');

        // --- Editing logic for deck info fields (auto-save on blur, Enter/Escape behavior) ---
        const handleEditClick = (e) => {
            const btn = e.target.closest('.edit-deck-info-btn');
            if (!btn) return;
            const type = btn.getAttribute('data-type');
            const span = btn.closest('span');
            if (!span) return;

            // Get current value from the parent span of the button
            const currentValue = span.querySelector('.notes-value').textContent || '';

            // Create input
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentValue;
            input.className = 'deck-info-edit-input';
            input.setAttribute('aria-label', 'Edit deck info');
            input.style.width = '70%';

            // Replace span content
            const originalHTML = span.innerHTML;
            span.innerHTML = '';
            span.appendChild(input);
            input.focus();

            let escapePressed = false;

            // Save logic: only if changed
            const doSaveIfChanged = async () => {
                const newValue = input.value;
                // Restore original HTML
                span.innerHTML = originalHTML;
                // Re-attach the edit button listener
                span.querySelector('.edit-deck-info-btn').addEventListener('click', handleEditClick);
                if (newValue !== currentValue) {
                    this.uiController.showStatus(`Saving ${type} changes...`, 'loading');
                    // Find row and column indices in the Deck Notes sheet
                    const deckInfo = this.deckNotesMap.get(deckString) || {};
                    const row = deckInfo.row;
                    const colMap = this.deckNotesColumnMap;
                    const col = colMap[type];
                    // Find the "Deck Notes" sheet
                    const deckNotesSheet = this.currentData.sheets.find(sheet => 
                        sheet.title && sheet.title.toLowerCase().includes('deck notes')
                    );
                    // Do a checked update to save the edited cell
                    const updates = {
                        updates: [{
                            sheetId: deckNotesSheet.sheetId,
                            row: row + 1, // +1 because sheets are 1-indexed
                            col: col + 1, // +1 because sheets are 1-indexed
                            value: newValue,
                            expectedValue: currentValue, // Only update if current value matches old content
                            valueType: 'auto-detect',
                        }]
                    };
                    const result = await this.sheetsAPI.checkedUpdateSheetData(this.currentData.sheetId, updates);
                    
                    if (result && result.skippedCells == 0) {
                        if (type === 'notes') deckInfo.notes = newValue;
                        else if (type === 'additionalNotes') deckInfo.additionalNotes = newValue;
                        else if (type === 'clock'){
                            deckInfo.goldfishClock = newValue;
                            if (colMap.goldfishSignature>-1) {
                                // Automatically sign this clock with the guru signature
                                const updates = [{
                                    sheetId: deckNotesSheet.sheetId,
                                    row: row + 1, // +1 because sheets are 1-indexed
                                    col: colMap.goldfishSignature + 1, // +1 because sheets are 1-indexed
                                    value: this.guruSignature,
                                    valueType: 'string',
                                }]
                                this.sheetsAPI.updateSheetData(this.currentData.sheetId, { updates });
                                deckInfo.goldfishSignature = this.guruSignature;
                            }
                        }
                        this.deckNotesMap.set(deckString, { ...deckInfo });
                        const notesValueSpan = span.querySelector('.notes-value');
                        if (notesValueSpan) {
                            notesValueSpan.textContent = newValue;
                        }
                        this.uiController.showStatus(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully!`, 'success');
                    } else {
                        this.uiController.showStatus(`Failed to save ${type} changes. The original data may have been modified.`, 'info');
                        console.warn(`Failed to save ${type} changes:`, result);
                    }
                }
            };

            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    input.blur();
                } else if (ev.key === 'Escape') {
                    input.value = currentValue;
                    input.blur();
                }
            });

            input.addEventListener('blur', doSaveIfChanged);
        };

        deckInfoDiv.querySelectorAll('.edit-deck-info-btn').forEach(btn => {
            btn.addEventListener('click', handleEditClick);
        });
    }

    // --- MATCH TABLE MODAL ---
    async showMatchTableModal() {
        // Remove any existing modal
        this.closeMatchTableModal();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'match-table-overlay';

        // Modal container
        const modal = document.createElement('div');
        modal.className = 'match-table-modal';

        const table = document.createElement('table');
        table.className = 'match-table';

        const threadMap = await this.getMatchTableThreadMap();
        const tableColumnCount = 4;
        let lastDeck = null;
        const groupedRowsHtml = this.allRows.map((row, idx) => {
            const parts = [];
            if (row.player1 !== lastDeck) {
                lastDeck = row.player1;
                parts.push(`
                    <tr class="deck-group-header">
                        <th colspan="${tableColumnCount}" class="deck-group-header-name">
                            <span class="deck-group-header-p1">P1</span>
                            ${lastDeck || 'Unknown deck'}
                        </th>
                    </tr>
                `);
            }

            const sig = this.getCurrentColorSignature(row) || '';
            const hasThread = this.hasDiscordThreadForRow(threadMap, row, idx);
            const statusDescriptor = this.getMatchStatus(row, idx, { hasThread });
            const statusMarkup = this.renderMatchStatus(statusDescriptor);
            const highlight = idx === this.currentRowIndex ? 'current-row' : '';
            const isCurrentGuruRow = sig === this.guruSignature ? 'current-guru-row' : '';
            parts.push(`
                <tr data-row="${idx}" class="${highlight} ${isCurrentGuruRow}">
                    <td>${idx + 1}</td>
                    <td>${row.player2}</td>
                    <td class="match-status-cell">${statusMarkup}</td>
                    <td>${sig}</td>
                </tr>
            `);
            return parts.join('');
        }).join('');

        table.innerHTML = `
            <thead>
                <tr>
                    <th>#</th>
                    <th>Player 2 Deck</th>
                    <th>Status</th>
                    <th>Signature</th>
                </tr>
            </thead>
            <tbody>
                ${groupedRowsHtml}
            </tbody>
        `;
        modal.appendChild(table);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Row click: jump to match
        table.addEventListener('click', (e) => {
            const tr = e.target.closest('tr[data-row]');
            if (tr) {
                const idx = parseInt(tr.getAttribute('data-row'), 10);
                this.currentRowIndex = idx;
                this.showCurrentRow();
                this.closeMatchTableModal();
            }
        });

        // Click outside modal closes if a row is selected
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay && this.currentRowIndex >= 0) {
                this.showCurrentRow();
                this.closeMatchTableModal();
            }
        });

        // Auto-scroll to the current match row and set sticky offsets once layout is ready
        requestAnimationFrame(() => {
            const thead = table.querySelector('thead');
            if (thead) {
                const headHeight = thead.getBoundingClientRect().height;
                if (headHeight) {
                    table.style.setProperty('--match-table-head-offset', `${headHeight}px`);
                }
            }

            const currentRow = table.querySelector('tr.current-row');
            if (currentRow) {
                currentRow.scrollIntoView({ block: 'center', behavior: 'auto' });
            }
        });
    }

    closeMatchTableModal() {
        const existing = document.querySelector('.match-table-overlay');
        if (existing) existing.remove();
    }

    getMatchStatus(row, rowIndex, options = {}) {
        const currentSignature = (this.getCurrentColorSignature(row) || '').trim();
        if (!currentSignature) {
            return {
                key: 'unclaimed',
                label: 'Unclaimed',
                type: 'emoji',
                value: ''
            };
        }

        const hasResult = this.hasCurrentColorResult(row);
        if (!hasResult) {
            return {
                key: 'claimed',
                label: 'Claimed',
                type: 'emoji',
                value: '⏳'
            };
        }

        const hasThread = Boolean(options.hasThread);
        const hasDiscrepancy = this.rowHasDiscrepancy(row);
        if (hasDiscrepancy && hasThread) {
            return {
                key: 'discrepancy_thread',
                label: 'Discrepancy (thread exists)',
                type: 'emoji',
                value: '⚠️'
            };
        }
        if (hasDiscrepancy) {
            return {
                key: 'discrepancy',
                label: 'Discrepancy',
                type: 'emoji',
                value: '❗'
            };
        }

        const inverseSuspected = this.isInverseErrorSuspected(rowIndex);
        if (inverseSuspected) {
            return {
                key: 'inverse_error',
                label: 'Inverse error suspected',
                type: 'emoji',
                value: '↕️'
            };
        }

        if (this.allGurusHaveMatchingResults(row)) {
            return {
                key: 'complete',
                label: 'Complete',
                type: 'image',
                value: 'images/compleated.webp'
            };
        }

        return {
            key: 'solved',
            label: 'Solved',
            type: 'emoji',
            value: '✅'
        };
    }

    renderMatchStatus(status) {
        if (!status) {
            return '';
        }

        const label = status.label || '';
        if (status.type === 'image' && status.value) {
            return `<img src="${status.value}" alt="${label}" title="${label}" class="match-status-icon match-status-image" loading="lazy" />`;
        }

        const content = status.value || '';
        if (!content) {
            return `<span class="match-status-icon match-status-empty" aria-label="${label}" title="${label}"></span>`;
        }

        return `<span class="match-status-icon" aria-label="${label}" title="${label}">${content}</span>`;
    }

    async getMatchTableThreadMap() {
        if (!this.hub) {
            return null;
        }

        try {
            return await this.hub.getThreads();
        } catch (error) {
            console.warn('Failed to load thread data for match table:', error);
            return this.hub.threadsCache || null;
        }
    }

    getRowThreadId(row, fallbackIndex) {
        if (row && typeof row.rowIndex === 'number') {
            return row.rowIndex;
        }
        if (row && typeof row.originalRowIndex === 'number') {
            return row.originalRowIndex;
        }
        return fallbackIndex + 1;
    }

    hasDiscordThreadForRow(threadMap, row, fallbackIndex) {
        if (!threadMap || typeof threadMap.has !== 'function') {
            return false;
        }
        const rowId = this.getRowThreadId(row, fallbackIndex);
        return rowId != null && threadMap.has(rowId);
    }

    hasCurrentColorResult(row) {
        return hasCurrentColorResult(row, this.currentGuruColor);
    }

    rowHasDiscrepancy(row) {
        return rowHasDiscrepancy(row);
    }

    rowHasMyDiscrepancy(row) {
        return rowHasMyDiscrepancy(row, this.currentGuruColor, this.guruSignature);
    }

    getGuruAnalysisValues(row) {
        return getGuruAnalysisValues(row);
    }

    allGurusHaveMatchingResults(row) {
        return allGurusHaveMatchingResults(row);
    }

    normalizeAnalysisForComparison(value) {
        return normalizeAnalysisForComparison(value);
    }

    isInverseErrorSuspected(rowIndex) {
        return isInverseErrorSuspected(this.allRows, rowIndex, (index) => this.findMirrorMatchIndex(index));
    }

    isOutcomeValueValidForInverse(value) {
        return isOutcomeValueValidForInverse(value);
    }

    /**
     * Formats a deck string into card names with Scryfall links separated by pipes
     * @param {string} deckString - The deck string (e.g., "Card1 / Card2 / Card3")
     * @returns {string} - Formatted as "Card1 [↗](link) | Card2 [↗](link) | Card3 [↗](link)"
     */
    formatDeckForThread(deckString) {
        if (!deckString || !deckString.trim()) {
            return '';
        }
        
        // Parse the deck string using the same method as ScryfallAPI
        const cardNames = this.scryfallAPI.parseDeckString(deckString);
        
        // Join with pipes
        return cardNames.join(' | ');
    }

    /**
     * Shows modal with Discord thread text for the current match
     * @param {number} rowIndex - Index of the row to create thread text for
     */
    showCreateThreadModal(rowIndex) {
        if (rowIndex < 0 || rowIndex >= this.allRows.length) {
            console.warn('Invalid row index for thread creation');
            return;
        }
        
        const currentRow = this.allRows[rowIndex];
        const podName = this.currentData.metadata?.podName || 'Pod';
        const matchNumber = rowIndex + 1;
        
        // Format the thread text
        const p1Cards = this.formatDeckForThread(currentRow.player1);
        const p2Cards = this.formatDeckForThread(currentRow.player2);
        
        // Generate link to this match (without guru color parameter)
        const url = new URL(window.location.href);
        url.searchParams.delete('guru'); // Remove guru color from URL
        // Shared links are always canonical production URLs. The recipient's
        // own deployment preference decides where the link actually opens, so a
        // link copied from preview does not force preview on everyone.
        url.pathname = DEPLOYMENTS.production.path;
        const trueURL = this.currentData.metadata?.mainSheetLink || 'Fail'; 
        const trueID = trueURL.match(/[-\w]{25,}/); // Get 25 digit ID from sheet link 
        if(trueID) url.searchParams.set('pod',trueID); // If sheet has mainSheetLink metadata, link to that sheet instead
        const matchLink = url.toString();
        
        // Build correction string (e.g., "W/T->L")
        const correctionString = buildCorrectionString(currentRow, this.getCurrentColorAnalysis(currentRow));
        const threadText = `P1 - ${p1Cards}\nP2 - ${p2Cards}\n[See match on The Stylus](${matchLink}) :Stylus:${correctionString}\n`;
        
        // Calculate number of rows needed for textarea (count newlines + 1)
        const textareaRows = (threadText.match(/\n/g) || []).length + 1;
        
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'thread-modal-overlay';
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'thread-modal';
        const titleText = `${podName} ${matchNumber}`;
        const writeupCommand = `/writeup matchid:${podName} ${matchNumber}`;
        modal.innerHTML = `
            <div class="thread-modal-header">
                <h3>${titleText}</h3>
                <button class="copy-btn-icon copy-title-btn" title="Copy title to Clipboard">📋</button>
                <button class="close-thread-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
            </div>
            <div class="thread-modal-content">
                <p style="margin-bottom: 10px; color: #666; display: flex; align-items: center; justify-content: space-between;">
                    <span>Copy this text to create a <a href="https://discord.com/channels/1051702336113889330/1145460704724398181" target="_blank" style="display: inline-flex; align-items: center; gap: 4px;"><img src="images/Discord-Symbol-Blurple.svg" alt="Discord" style="width: 16px; height: 16px; vertical-align: middle;" />Guru Match Help post</a> for this match:</span>
                    <button class="copy-btn-icon copy-thread-btn" title="Copy to Clipboard">📋</button>
                </p>
                <textarea readonly class="thread-text-area" rows="${textareaRows}" style="width: 100%; font-family: monospace; padding: 12px; border: 1px solid #ddd; border-radius: 4px; resize: none;">${threadText}</textarea>
                <p style="margin-top: 16px; margin-bottom: 10px; color: #666; display: flex; align-items: center; justify-content: space-between;">
                    <span>Then run this command in the thread:</span>
                    <button class="copy-btn-icon copy-writeup-btn" title="Copy command to Clipboard">📋</button>
                </p>
                <div style="font-family: monospace; padding: 12px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5;">${writeupCommand}</div>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Auto-select text in textarea
        const textarea = modal.querySelector('.thread-text-area');
        textarea.select();
        
        // Shared copy button handler
        const setupCopyButton = (button, textToCopy, defaultTitle) => {
            button.addEventListener('click', () => {
                if (button.classList.contains('copy-thread-btn')) {
                    textarea.select();
                }
                navigator.clipboard.writeText(textToCopy).then(() => {
                    button.textContent = '✓';
                    button.style.color = '#28a745';
                    button.title = 'Copied!';
                    setTimeout(() => {
                        button.textContent = '📋';
                        button.style.color = '#5865F2';
                        button.title = defaultTitle;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                    button.textContent = '✗';
                    button.style.color = '#dc3545';
                    button.title = 'Failed to copy';
                });
            });
        };
        
        // Setup copy buttons
        setupCopyButton(modal.querySelector('.copy-title-btn'), titleText, 'Copy title to Clipboard');
        setupCopyButton(modal.querySelector('.copy-thread-btn'), threadText, 'Copy to Clipboard');
        setupCopyButton(modal.querySelector('.copy-writeup-btn'), writeupCommand, 'Copy command to Clipboard');
        
        // Close on escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeCreateThreadModal();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    /**
     * Closes the create thread modal
     */
    closeCreateThreadModal() {
        const existing = document.querySelector('.thread-modal-overlay');
        if (existing) existing.remove();
    }
}
