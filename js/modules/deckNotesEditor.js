// DeckNotesEditor: Handles rendering and editing of the deck notes table
// Extracted from GuruAnalysisInterface.showDeckNotesEditor
export class DeckNotesEditor {
    constructor({ analysisInterface, uiController, scryfallAPI, sheetsAPI, spreadsheetId }) {
        this.analysisInterface = analysisInterface;
        this.uiController = uiController;
        this.scryfallAPI = scryfallAPI;
        this.sheetsAPI = sheetsAPI;
        this.spreadsheetId = spreadsheetId;
        this.notesData = null; // Will hold the current notes data
        this.clocksFilled = false; // Track if all clocks are filled
    }

    show(notesData, spreadsheetTitle) {
        this.notesData = notesData;
        if (!notesData || !notesData.values || notesData.values.length === 0) {
            return this.uiController.showStatus('No deck notes found. Check the spreadsheet.', 'error');
        }

        // Get the deck notes editor container or create a new one
        let deckNotesContainer = document.getElementById('deck-notes-screen');
        if (!deckNotesContainer) {
            deckNotesContainer = document.createElement('div');
            deckNotesContainer.id = 'deck-notes-screen';
            deckNotesContainer.className = 'deck-notes-screen full-screen';
        }

        const notes = notesData.values || [];
        if (notes.length === 0) {
            this.uiController.showStatus('No deck notes found. Check the spreadsheet.', 'error');
            return;
        }
        console.log(notesData)
        const headers = notes[0] || [];
        const headersClean = headers.map(header => header.toLowerCase().trim().replace(/\s+/g, '-'));
        const numCols = headers.length;
        var fixed = headers.findIndex(header => header.toLowerCase().trim() === 'signature');
        if (fixed === -1) {
            fixed = [];
        } else {
            fixed = [fixed];
        }

        // Check if we need hover preview for cards
        const pointerType = this.uiController.getPointerType();
        let needHoverPreview = true;
        if (pointerType === 'touch' || pointerType === 'pen') {
            // Disable hover preview for touch/pen devices
            needHoverPreview = false;
        }

        deckNotesContainer.innerHTML = `
            <div class="deck-notes-editor">
                <div class="deck-notes-editor-header">
                    <div class="deck-notes-editor-controls">
                        <button id="deck-notes-close-btn" class="exit-btn">X</button>
                    </div>
                    <h3>Deck Notes Editor</h3>
                </div>
                <div class="deck-notes-editor-publish">
                    <button id="deck-notes-publish-btn" class="primary-btn">Start guruing</button>
                </div>
                <h4>${spreadsheetTitle}</h4>
                <p>All goldfish clocks must be filled before guruing can begin. Add notes as needed.</p>
                <table id="deck-notes-table" class="deck-notes-table">
                    <thead>
                        <tr>
                            ${headersClean.map((header, index) => `
                                <th header="${header}">${headers[index]}</th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${notes.slice(1).map((row, rowIndex) => {
                            const paddedRow = [...row];
                            while (paddedRow.length < numCols) paddedRow.push("");
                            const decklist = paddedRow[0] || '';
                            const cards = this.scryfallAPI.parseDeckString(decklist);
                            // Preload cards for hover preview
                            if (needHoverPreview) this.scryfallAPI.preloadCards(decklist);
                            // If the first cell is a deck string, show it as a list of cards with hover preview and Scryfall link
                            if (cards.length > 0) {
                                paddedRow[0] = `${cards.map(card => {
                                    const scryfallUrl = this.scryfallAPI.getCardUrl(card);
                                    return `<a href="${scryfallUrl}" target="_blank" rel="noopener noreferrer" class="deck-card-link"><li class="deck-card" data-card-name="${card}">${card}</li></a>`;
                                }).join('')}`;
                            }
                            return `<tr>` +
                                `<td class="deck-cards-list" data-row="${rowIndex + 1}" data-col="0"><ul>${paddedRow[0]}</ul></td>` +
                                // row-col Index here are offset by 1, so add 1 to get the real index in the data
                                paddedRow.slice(1).map((cell, colIndex) => {
                                    const header = headersClean[colIndex+1];
                                    const editable = header !== 'signature';
                                    const classList = editable ? 'editable pulled' : 'pulled';
                                    return `<td class="${classList}" contenteditable="${editable}" data-row="${rowIndex + 1}" data-col="${colIndex+1}" header="${header}">${cell}</td>`;
                                }).join('') +
                                `</tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

        const deckNotesTable = deckNotesContainer.querySelector('#deck-notes-table');
        if (deckNotesTable) {
            // Make Enter key submit the cell edit
            deckNotesTable.addEventListener('keydown', function(e) {
                if (e.target.isContentEditable && e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            const onCellEditFinished = async (e) => {
                const content = e.target.textContent;
                const row = e.target.dataset.row;
                const col = e.target.dataset.col;
                const oldContent = (notes[row] && notes[row][col]) ? notes[row][col] : '';
                if (content === oldContent) {
                    // No change, do nothing
                    return;
                }
                console.log(`Cell edited: Row ${row}, Col ${col}, Content: "${content}"`);

                // Do a checked update to save the edited cell
                const updates = {
                    updates: [{
                        sheetId: this.notesData.sheetId,
                        row: parseInt(row) + 1, // +1 because sheets are 1-indexed
                        col: parseInt(col) + 1, // +1 because sheets are 1-indexed
                        value: content,
                        expectedValue: oldContent, // Only update if current value matches old content
                        valueType: 'auto-detect',
                    }]
                };
                const result = await this.sheetsAPI.checkedUpdateSheetData(this.spreadsheetId, updates);
                if (!result || result.skippedCells > 0) {
                    this.uiController.showStatus('Cell update failed, content may have been changed by someone else.', 'info');
                } else {
                    this.notesData.values[row][col] = content; // Update local notes data
                    if (headers[col] == 'Goldfish Clock' && headers.includes('Signature')) {
                        // Update the signature in the spreadsheet
                        const signatureCol = headers.indexOf('Signature');
                        const signature = this.analysisInterface.guruSignature;
                        const signatureUpdates = {
                            updates: [{
                                sheetId: this.notesData.sheetId,
                                row: parseInt(row) + 1, // +1 because sheets are 1-indexed
                                col: signatureCol + 1, // +1 because sheets are 1-indexed
                                value: signature,
                                valueType: 'string',
                            }]
                        };
                        await this.sheetsAPI.updateSheetData(this.spreadsheetId, signatureUpdates);
                        this.notesData.values[row][signatureCol] = signature;
                        // Update the signature in the UI
                        const signatureCell = deckNotesTable.querySelector(`td[data-row="${row}"][data-col="${signatureCol}"]`);
                        if (signatureCell) {
                            signatureCell.textContent = signature;
                        }
                    }
                }
            };

            // Attach to all editable cells
            deckNotesTable.querySelectorAll('.editable').forEach(cell => {
                cell.addEventListener('blur', onCellEditFinished);
            });

            // Card hover image preview logic
            let cardPreviewImg = null;
            let previewTimeout = null;
            // Mouse enter handler
            const mouseEnterHandler = async (e) => {
                const cardDiv = e.target.closest('.deck-card');
                if (cardDiv && cardDiv.dataset.cardName) {
                    // Delay preview to avoid accidental flicker
                    previewTimeout = setTimeout(async () => {
                        // Only show one preview at a time
                        if (cardPreviewImg) cardPreviewImg.remove();
                        try {
                            const cardName = cardDiv.dataset.cardName;
                            cardPreviewImg = await this.scryfallAPI.getCardImage(cardName);
                        } catch (err) {
                            cardPreviewImg = document.createElement('img');
                            cardPreviewImg.src = '';
                            cardPreviewImg.alt = 'Image not found';
                        }
                        cardPreviewImg.className = 'card-hover-preview';

                        // Position near mouse
                        const imgWidth = 320;  // match your maxWidth
                        const imgHeight = 440; // match your maxHeight
                        const padding = 12;
                        let left = e.clientX + 18;
                        let top = e.clientY - 20;

                        // Clamp right edge
                        if (left + imgWidth + padding > window.innerWidth) {
                        left = window.innerWidth - imgWidth - padding;
                        }
                        // Clamp left edge
                        if (left < padding) left = padding;

                        // Clamp bottom edge
                        if (top + imgHeight + padding > window.innerHeight) {
                        top = window.innerHeight - imgHeight - padding;
                        }
                        // Clamp top edge
                        if (top < padding) top = padding;

                        cardPreviewImg.style.left = left + 'px';
                        cardPreviewImg.style.top = top + 'px';

                        document.body.appendChild(cardPreviewImg);

                        // Remove on mouseleave
                        const removePreview = () => {
                            if (cardPreviewImg) cardPreviewImg.remove();
                            cardPreviewImg = null;
                        };
                        cardDiv.addEventListener('mouseleave', removePreview, { once: true });
                    }, 200); // 200ms delay
                }
            };
            // Mouse leave handler
            const mouseLeaveHandler = (e) => {
                if (previewTimeout) {
                    clearTimeout(previewTimeout);
                    previewTimeout = null;
                }
                if (cardPreviewImg) {
                    cardPreviewImg.remove();
                    cardPreviewImg = null;
                }
            };

            deckNotesTable.addEventListener('mouseenter', mouseEnterHandler, true);
            deckNotesTable.addEventListener('mouseleave', mouseLeaveHandler, true);
        }
        // Add close button functionality
        const closeBtn = deckNotesContainer.querySelector('#deck-notes-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close(true));
        }

        // Add publish button functionality
        const publishBtn = deckNotesContainer.querySelector('#deck-notes-publish-btn');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => this.unhideGuruSheets());
        }

        if (!this.allClocksFilled()) {
            // Hide publish button if clocks are not filled
            publishBtn.style.display = 'none';
        }

        // Insert the deck notes container in the "sheet-editor" area
        const sheetEditor = document.getElementById('sheet-editor');
        sheetEditor.insertBefore(deckNotesContainer, sheetEditor.firstChild);

        // Hide the guru analysis interface while the deck notes editor is open
        const analysisInterfaceEl = document.getElementById('guru-analysis-interface');
        if (analysisInterfaceEl) {
            analysisInterfaceEl.style.display = 'none';
        }

        // Set up periodic updates
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
        this._updateInterval = setInterval(() => {
            if (this.notesData) {
                this.pullUpdates();
            }
        }, 3000);
    }

    allClocksFilled() {
        // Check if all goldfish clocks are filled
        const notes = this.notesData.values || [];
        for (let i = 1; i < notes.length; i++) { // Skip header row
            const row = notes[i];
            if (!row || !row[1]) {
                return false; // Found an empty clock
            }
        }
        if (!this.clocksFilled) {
            this.clocksFilled = true;
            this.uiController.showStatus('All goldfish clocks are filled. You can now start guruing!', 'success');
        }
        return true; // All clocks are filled
    }

    async pullUpdates() {
        // Pull updates from the Google Sheets API
        const notesData = await this.sheetsAPI.getDeckNotes(this.spreadsheetId, this.notesData);
        await this.updateValues(notesData);
    }

    close(backToHome = false) {
        // Remove the deck notes editor from the DOM and stop updates
        const deckNotesContainer = document.getElementById('deck-notes-screen');
        if (deckNotesContainer && deckNotesContainer.parentNode) {
            deckNotesContainer.parentNode.removeChild(deckNotesContainer);
        }
        this.stopPeriodicUpdate();
        
        // Restore the guru analysis interface visibility when closing the deck notes editor
        const analysisInterfaceEl = document.getElementById('guru-analysis-interface');
        if (analysisInterfaceEl) {
            analysisInterfaceEl.style.display = '';
        }

        if (backToHome) {
            this.uiController.showSheetInputSection();
        }
    }

    stopPeriodicUpdate() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }   

    async updateValues(notesData) {
        // Update the deck notes table with new data
        const deckNotesTable = document.getElementById('deck-notes-table');
        if (!deckNotesTable) return;

        const notes = notesData.values || [];

        // Loop through pulled data cells and update their content
        deckNotesTable.querySelectorAll('.pulled').forEach((cell) => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            // check if cell content has changed
            const newData = (notesData.values[row] && notesData.values[row][col]) ? notesData.values[row][col] : '';
            const oldData = (this.notesData.values[row] && this.notesData.values[row][col]) ? this.notesData.values[row][col] : '';
            if (newData !== oldData) {
                cell.textContent = newData;
                this.notesData.values[row][col] = newData; // Update local notes data
                // If the cell is focused, blur it to discard any user edits
                if (document.activeElement === cell) {
                    cell.blur();
                }
                // Briefly highlight the updated cell
                cell.classList.add('updated');
                setTimeout(() => {
                    cell.classList.remove('updated');
                }, 300);
            }
        });

        const publishBtn = document.getElementById('deck-notes-publish-btn');
        if (this.allClocksFilled()) {
            // Show publish button if all clocks are filled
            if (publishBtn) {
                publishBtn.style.display = 'block';
            }
        } else {
            // Hide publish button if clocks are not filled
            if (publishBtn) {
                publishBtn.style.display = 'none';
            }
        }
    }

    async unhideGuruSheets() {
        // Unhide the Guru sheets in the spreadsheet and move to the analysis interface
        await this.sheetsAPI.unhideGuruSheets(this.spreadsheetId);
        this.close();

        const sheetData = await this.sheetsAPI.getSheetData(this.spreadsheetId);
        this.analysisInterface.loadData(sheetData);
    }
}
