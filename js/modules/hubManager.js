import { extractSheetId, isValidGoogleSheetsUrl } from '../utils/urlUtils.js';
import { podNameToCode, podCodeToName } from '../utils/podUtils.js';

/**
 * Manages interaction with Guru Hub spreadsheets.
 * Loads and caches thread information from the "All Threads" sheet.
 */
export class HubManager {
    /**
     * @param {string} hubLink - The Google Sheets URL or ID of the Guru Hub spreadsheet
     * @param {string} podName - The full pod name (e.g., "Novice I")
     */
    constructor(hubLink, podName=null) {
        this.hubLink = hubLink;
        if (podName) {
            this.podCode = podNameToCode(podName);
        } else {
            this.podCode = null;
        }
        
        // Extract the spreadsheet id from the URL if a full URL was provided
        if (isValidGoogleSheetsUrl(hubLink)) {
            const spreadsheetId = extractSheetId(hubLink);
            if (!spreadsheetId) {
                throw new Error('Invalid hub link or spreadsheet id');
            }
            this.hubSpreadsheetId = spreadsheetId;
        } else {
            this.hubSpreadsheetId = hubLink;
        }
        
        // Cache for the ID# -> Thread mapping
        this.threadsCache = null;
        
        // Cache for the pods data from Totals sheet
        this.podsCache = null;
    }

    /**
     * Loads the "All Threads" sheet and filters by pod code.
     * Creates a mapping of ID# (integer) to Thread URL (string).
     * @returns {Promise<Map<number, string>>} Map of ID numbers to Discord thread URLs
     */
    async loadThreads() {
        try {
            console.log(`📥 Loading threads from hub for pod: ${this.podCode}`);

            // Get the spreadsheet data with hyperlinks
            // We need to use spreadsheets.get to access hyperlink formulas
            const response = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: this.hubSpreadsheetId,
                ranges: ["'All Threads'!A:D"],
                fields: 'sheets.data.rowData.values(formattedValue,hyperlink)'
            });

            const sheets = response.result.sheets || [];
            if (sheets.length === 0 || !sheets[0].data || !sheets[0].data[0].rowData) {
                console.warn('⚠️ All Threads sheet is empty');
                this.threadsCache = new Map();
                return this.threadsCache;
            }

            const rowData = sheets[0].data[0].rowData || [];
            
            if (rowData.length === 0) {
                console.warn('⚠️ All Threads sheet is empty');
                this.threadsCache = new Map();
                return this.threadsCache;
            }

            // First row should be headers: Pod, Thread, ID#
            // Find column indices from header row
            const headerRow = rowData[0].values || [];
            const podIndex = headerRow.findIndex(cell => 
                cell?.formattedValue?.toLowerCase().trim() === 'pod'
            );
            const threadIndex = headerRow.findIndex(cell => 
                cell?.formattedValue?.toLowerCase().trim() === 'thread'
            );
            const idIndex = headerRow.findIndex(cell => 
                cell?.formattedValue?.toLowerCase().trim() === 'id#'
            );

            if (podIndex === -1 || threadIndex === -1 || idIndex === -1) {
                throw new Error('Required columns not found in All Threads sheet. Expected: Pod, Thread, ID#. Found: ' + headerRow.map(cell => cell?.formattedValue).join(', '));
            }

            // Build the mapping from ID# to Thread URL for rows matching our pod code
            const threadsMap = new Map();
            
            for (let i = 1; i < rowData.length; i++) {
                const row = rowData[i];
                if (!row || !row.values || row.values.length === 0) continue;

                const cells = row.values;
                const pod = cells[podIndex]?.formattedValue?.toString().trim();
                const threadUrl = cells[threadIndex]?.hyperlink; // Extract the hyperlink URL
                const idStr = cells[idIndex]?.formattedValue?.toString().trim();

                // Filter by pod code and ensure we have valid data
                if ((pod === this.podCode || this.podCode === null) && threadUrl && idStr) {
                    const idNum = parseInt(idStr, 10);
                    if (!isNaN(idNum)) {
                        threadsMap.set(idNum, threadUrl);
                    }
                }
            }

            console.log(`✅ Loaded ${threadsMap.size} threads for pod ${this.podCode}`);

            // Cache the result
            this.threadsCache = threadsMap;
            return threadsMap;

        } catch (error) {
            console.error('❌ Error loading threads from hub:', error);
            throw new Error(`Failed to load threads: ${error.message}`);
        }
    }

    /**
     * Gets the threads mapping, using cache if available or loading if not.
     * @returns {Promise<Map<number, string>>} Map of ID numbers to thread names
     */
    async getThreads() {
        if (this.threadsCache !== null) {
            console.log('📋 Returning cached threads');
            return this.threadsCache;
        }

        return await this.loadThreads();
    }

    /**
     * Clears the cached threads and pods, forcing a reload on next get call
     */
    clearCache() {
        this.threadsCache = null;
        this.podsCache = null;
        console.log('🗑️ Threads and pods cache cleared');
    }

    /**
     * Gets a specific Discord thread URL by ID#
     * @param {number} id - The ID number to lookup
     * @returns {Promise<string|null>} The Discord thread URL, or null if not found
     */
    async getThreadById(id) {
        const threads = await this.getThreads();
        return threads.get(id) || null;
    }

    /**
     * Checks if a thread ID exists in the cache
     * @param {number} id - The ID number to check
     * @returns {Promise<boolean>} True if the ID exists
     */
    async hasThread(id) {
        const threads = await this.getThreads();
        return threads.has(id);
    }

    /**
     * Loads the "Totals" sheet and parses pod information.
     * Creates an array of pod objects with their details.
     * @returns {Promise<Array<Object>>} Array of pod objects with pod name, discrepancies, incompletes, and sheet link
     */
    async loadPods() {
        try {
            console.log(`📥 Loading pods from hub Totals sheet`);

            // Get the spreadsheet data with hyperlinks
            const response = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: this.hubSpreadsheetId,
                ranges: ["'Totals'"],
                fields: 'sheets.data.rowData.values(formattedValue,hyperlink)'
            });

            const sheets = response.result.sheets || [];
            if (sheets.length === 0 || !sheets[0].data || !sheets[0].data[0].rowData) {
                console.warn('⚠️ Totals sheet is empty');
                this.podsCache = [];
                return this.podsCache;
            }

            const rowData = sheets[0].data[0].rowData || [];
            
            if (rowData.length < 3) {
                console.warn('⚠️ Totals sheet has insufficient rows');
                this.podsCache = [];
                return this.podsCache;
            }

            // Row 1 and 2 contain headers (Sheet Link spans both rows 1 and 2)
            // We'll check row 1 first, but for "Sheet Link" we need to check row 2 as well
            const headerRow1 = rowData[0].values || [];
            const headerRow2 = rowData[1].values || [];
            
            // Find column indices from header rows
            let podIndex = -1;
            let discrepanciesIndex = -1;
            let incompletesIndex = -1;
            let sheetLinkIndex = -1;

            // Check row 1 for most headers
            headerRow1.forEach((cell, index) => {
                const value = cell?.formattedValue?.toString().toLowerCase().trim();
                if (value?.includes('pod') && podIndex === -1) {
                    podIndex = index;
                } else if (value?.includes('discrepancies')) {
                    discrepanciesIndex = index;
                } else if (value?.includes('incompletes')) {
                    incompletesIndex = index;
                }
            });

            // Check row 2 for "Sheet Link" (since it spans rows 1-2)
            headerRow2.forEach((cell, index) => {
                const value = cell?.formattedValue?.toString().toLowerCase().trim();
                if (value === 'sheet link') {
                    sheetLinkIndex = index;
                }
            });

            // Also check row 1 for Sheet Link just in case
            if (sheetLinkIndex === -1) {
                headerRow1.forEach((cell, index) => {
                    const value = cell?.formattedValue?.toString().toLowerCase().trim();
                    if (value === 'sheet link') {
                        sheetLinkIndex = index;
                    }
                });
            }

            if (podIndex === -1 || discrepanciesIndex === -1 || incompletesIndex === -1 || sheetLinkIndex === -1) {
                console.warn('⚠️ Could not find all required columns in Totals sheet');
                console.warn(`Found indices - Pod: ${podIndex}, Discrepancies: ${discrepanciesIndex}, Incompletes: ${incompletesIndex}, Sheet Link: ${sheetLinkIndex}`);
                this.podsCache = [];
                return this.podsCache;
            }

            console.log(`📋 Found columns - Pod: ${podIndex}, Discrepancies: ${discrepanciesIndex}, Incompletes: ${incompletesIndex}, Sheet Link: ${sheetLinkIndex}`);

            // Parse data rows starting from row 3 (index 2)
            const pods = [];
            
            for (let i = 2; i < rowData.length; i++) {
                const row = rowData[i];
                if (!row || !row.values || row.values.length === 0) continue;

                const cells = row.values;
                
                // Get data from relevant columns
                const sheetLinkCell = cells[sheetLinkIndex];
                const sheetLink = sheetLinkCell?.hyperlink || sheetLinkCell?.formattedValue;
                const podCode = cells[podIndex]?.formattedValue?.toString().trim() || '';
                const discrepancies = cells[discrepanciesIndex]?.formattedValue?.toString().trim() || '0';
                const incompletes = cells[incompletesIndex]?.formattedValue?.toString().trim() || '0';

                // Convert pod code to pod name
                let podName = '';
                try {
                    podName = podCode ? podCodeToName(podCode) : '';
                } catch (error) {
                    console.warn(`⚠️ Could not convert pod code "${podCode}" to name:`, error.message);
                    podName = podCode; // Fall back to using the code as-is
                }

                pods.push({
                    podName,
                    discrepancies: parseInt(discrepancies, 10) || 0,
                    incompletes: parseInt(incompletes, 10) || 0,
                    sheetLink
                });
            }

            console.log(`✅ Loaded ${pods.length} pods from Totals sheet`);

            // Cache the result
            this.podsCache = pods;
            return pods;

        } catch (error) {
            console.error('❌ Error loading pods from hub:', error);
            throw new Error(`Failed to load pods: ${error.message}`);
        }
    }

    /**
     * Gets the pods data, using cache if available or loading if not.
     * @returns {Promise<Array<Object>>} Array of pod objects
     */
    async getPods() {
        if (this.podsCache !== null) {
            console.log('📋 Returning cached pods');
            return this.podsCache;
        }

        return await this.loadPods();
    }

    /**
     * Gets the title of the hub spreadsheet
     * @returns {Promise<string>} The title of the hub spreadsheet
     */
    async getHubTitle() {
        try {
            console.log(`📥 Loading hub title for spreadsheet: ${this.hubSpreadsheetId}`);

            const response = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: this.hubSpreadsheetId,
                fields: 'properties.title'
            });

            const title = response.result.properties?.title || 'Untitled Hub';
            console.log(`✅ Hub title: ${title}`);
            return title;

        } catch (error) {
            console.error('❌ Error loading hub title:', error);
            throw new Error(`Failed to load hub title: ${error.message}`);
        }
    }

    /**
     * Gets the full URL of the hub spreadsheet
     * @returns {string} The Google Sheets URL for this hub
     */
    getHubUrl() {
        return `https://docs.google.com/spreadsheets/d/${this.hubSpreadsheetId}`;
    }
}
