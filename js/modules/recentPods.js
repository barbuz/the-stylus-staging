import { CONFIG } from '../config.js';
import { getElement } from '../utils/domUtils.js';
import { HubManager } from './hubManager.js';
import { getRecordSpreadsheetId, normaliseRecords } from '../domain/recentEntries.js';

export class RecentPodsManager {
    constructor() {
        this.maxRecentPods = 20; // Keep last 20 pods
        this.maxRecentHubs = 20; // Keep last 20 hubs
        this.recentPods = [];
        this.recentHubs = [];
        this.timeAgoCache = new Map(); // Cache time ago calculations
        this.cacheExpiry = 60000; // 1 minute cache expiry
        this.userPreferences = null; // Will be set when auth manager is available
        this.isInitialized = false;
        this.expandedHubs = new Set(); // Track which hubs are expanded
        this.hubManagers = new Map(); // Cache HubManager instances by spreadsheetId
    }

    /**
     * Set the user preferences service (called from main.js after auth)
     */
    setUserPreferences(userPreferences) {
        this.userPreferences = userPreferences;
        this.isInitialized = true;
        // Reload pods and hubs from appData
        Promise.all([
            this.loadRecentPods(),
            this.loadRecentHubs()
        ]).then(() => {
            this.renderRecentPods();
        });
    }

    /**
     * Load recent pods from localStorage or Google Drive
     */
    async loadRecentPods() {
        try {
            let pods = [];
            
            if (this.userPreferences && this.userPreferences.isInitialized) {
                // Load from Google appData
                pods = await this.userPreferences.getRecentPods();
                console.log('📥 Loaded recent pods from Google appData:', pods.length, 'pods');
            } else {
                // Fall back to localStorage
                const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
                pods = stored ? JSON.parse(stored) : [];
                console.log('📥 Loaded recent pods from localStorage:', pods.length, 'pods');
            }
            
            this.recentPods = normaliseRecords(pods);
            return this.recentPods;
        } catch (error) {
            console.error('Error loading recent pods:', error);
            this.recentPods = [];
            return [];
        }
    }

    /**
     * Save recent pods to localStorage or Google Drive
     * Always saves to localStorage first for instant response,
     * then saves to Google appData in background
     */
    async saveRecentPods() {
        try { 
            
            // Keep only the maximum number of pods
            if (this.recentPods.length > this.maxRecentPods) {
                this.recentPods = this.recentPods.slice(0, this.maxRecentPods);
            }
            
            // Always save to localStorage first for instant response
            localStorage.setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(this.recentPods));
            console.log('💾 Saved recent pods to localStorage:', this.recentPods.length, 'pods');
            
            // Then save to Google appData in background if available
            if (this.userPreferences && this.userPreferences.isInitialized) {
                // Don't await - let this happen in background
                this.userPreferences.setRecentPods(this.recentPods)
                    .then(() => {
                        console.log('☁️ Synced recent pods to Google appData in background');
                    })
                    .catch((error) => {
                        console.warn('Failed to sync recent pods to Google appData:', error);
                        // localStorage already has the data, so this is not critical
                    });
            }
        } catch (error) {
            console.error('Error saving recent pods:', error);
            // Try localStorage as last resort
            try {
                localStorage.setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(this.recentPods));
            } catch (e) {
                console.error('Failed to save to localStorage:', e);
            }
        }
    }

    /**
     * Add a pod to recent list
     * @param {string} spreadsheetId - Google Sheets file ID
     * @param {string} title - Pod title/name
     * @param {string} url - Full Google Sheets URL
     */
    async addRecentPod(spreadsheetId, title, url) {
        if (!spreadsheetId || !title || !url) {
            console.warn('Invalid pod data provided to addRecentPod');
            return;
        }

        // Check if pod already exists to preserve original dateAdded
        const existingPod = this.recentPods.find(pod => getRecordSpreadsheetId(pod) === spreadsheetId);
        const originalDateAdded = existingPod ? existingPod.dateAdded : Date.now();

        // Remove existing entry if it exists
        this.recentPods = this.recentPods.filter(pod => getRecordSpreadsheetId(pod) !== spreadsheetId);

        // Add to beginning of list with current timestamp for lastAccessed
        const now = Date.now();
        this.recentPods.unshift({
            spreadsheetId,
            title: title.trim(),
            url,
            lastAccessed: now,
            dateAdded: originalDateAdded // Preserve original dateAdded or use current time for new pods
        });

        await this.saveRecentPods();
        this.renderRecentPods();
        
        console.log(`📋 ${existingPod ? 'Updated' : 'Added'} "${title}" ${existingPod ? 'in' : 'to'} recent pods`);
    }

    /**
     * Remove a pod from recent list
     * @param {string} spreadsheetId - Google Sheets file ID to remove
     */
    async removeRecentPod(spreadsheetId) {
        this.recentPods = this.recentPods.filter(pod => getRecordSpreadsheetId(pod) !== spreadsheetId);
        await this.saveRecentPods();
        this.renderRecentPods();
        console.log(`🗑️ Removed pod from recent list: ${spreadsheetId}`);
    }

    /**
     * Clear all recent pods
     */
    async clearRecentPods() {
        this.recentPods = [];
        await this.saveRecentPods();
        this.renderRecentPods();
        console.log('🗑️ Cleared all recent pods');
    }

    /**
     * Get recent pods list
     */
    getRecentPods() {
        return [...this.recentPods]; // Return copy
    }

    /**
     * Load recent hubs from localStorage or Google Drive
     */
    async loadRecentHubs() {
        try {
            let hubs = [];
            
            if (this.userPreferences && this.userPreferences.isInitialized) {
                // Load from Google appData
                hubs = await this.userPreferences.getRecentHubs();
                console.log('📥 Loaded recent hubs from Google appData:', hubs.length, 'hubs');
            } else {
                // Fall back to localStorage
                const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);
                hubs = stored ? JSON.parse(stored) : [];
                console.log('📥 Loaded recent hubs from localStorage:', hubs.length, 'hubs');
            }
            
            this.recentHubs = normaliseRecords(hubs);
            return this.recentHubs;
        } catch (error) {
            console.error('Error loading recent hubs:', error);
            this.recentHubs = [];
            return [];
        }
    }

    /**
     * Save recent hubs to localStorage or Google Drive
     */
    async saveRecentHubs() {
        try { 
            // Keep only the maximum number of hubs
            if (this.recentHubs.length > this.maxRecentHubs) {
                this.recentHubs = this.recentHubs.slice(0, this.maxRecentHubs);
            }
            
            // Always save to localStorage first for instant response
            localStorage.setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(this.recentHubs));
            console.log('💾 Saved recent hubs to localStorage:', this.recentHubs.length, 'hubs');
            
            // Then save to Google appData in background if available
            if (this.userPreferences && this.userPreferences.isInitialized) {
                // Don't await - let this happen in background
                this.userPreferences.setRecentHubs(this.recentHubs)
                    .then(() => {
                        console.log('☁️ Synced recent hubs to Google appData in background');
                    })
                    .catch((error) => {
                        console.warn('Failed to sync recent hubs to Google appData:', error);
                        // localStorage already has the data, so this is not critical
                    });
            }
        } catch (error) {
            console.error('Error saving recent hubs:', error);
            // Try localStorage as last resort
            try {
                localStorage.setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(this.recentHubs));
            } catch (e) {
                console.error('Failed to save to localStorage:', e);
            }
        }
    }

    /**
     * Add a hub to recent list
     * @param {string} hubLink - Google Sheets URL or ID of the hub
     */
    async addRecentHub(hubLink) {
        if (!hubLink) {
            console.warn('Invalid hub link provided to addRecentHub');
            return;
        }

        try {
            // Create a HubManager instance to get hub details
            const hubManager = new HubManager(hubLink);
            const hubSpreadsheetId = hubManager.hubSpreadsheetId;
            const hubUrl = hubManager.getHubUrl();

            // Check if hub already exists to preserve original dateAdded
            const existingHub = this.recentHubs.find(hub => getRecordSpreadsheetId(hub) === hubSpreadsheetId);
            const originalDateAdded = existingHub ? existingHub.dateAdded : Date.now();

            // Get the hub title
            const title = await hubManager.getHubTitle();

            // Remove existing entry if it exists
            this.recentHubs = this.recentHubs.filter(hub => getRecordSpreadsheetId(hub) !== hubSpreadsheetId);

            // Add to beginning of list with current timestamp for lastAccessed
            const now = Date.now();
            this.recentHubs.unshift({
                spreadsheetId: hubSpreadsheetId,
                title: title.trim(),
                url: hubUrl,
                lastAccessed: now,
                dateAdded: originalDateAdded // Preserve original dateAdded or use current time for new hubs
            });

            // Clear all expanded hubs and set only this hub as expanded
            this.expandedHubs.clear();
            this.expandedHubs.add(hubSpreadsheetId);

            await this.saveRecentHubs();
            this.renderRecentPods(); // Re-render to update UI
            
            console.log(`📋 ${existingHub ? 'Updated' : 'Added'} "${title}" ${existingHub ? 'in' : 'to'} recent hubs`);

        } catch (error) {
            console.error('Error adding recent hub:', error);
        }
    }

    /**
     * Remove a hub from recent list
     * @param {string} spreadsheetId - Google Sheets file ID to remove
     */
    async removeRecentHub(spreadsheetId) {
        this.recentHubs = this.recentHubs.filter(hub => getRecordSpreadsheetId(hub) !== spreadsheetId);
        await this.saveRecentHubs();
        this.renderRecentPods();
        console.log(`🗑️ Removed hub from recent list: ${spreadsheetId}`);
    }

    /**
     * Render recent pods in the UI
     */
    renderRecentPods() {
        const recentPodsSection = getElement('recent-pods-section');
        const recentPodsList = getElement('recent-pods-list');

        if (!recentPodsSection || !recentPodsList) {
            console.warn('⚠️ Recent pods DOM elements not found');
            return;
        }


        // Show/hide section based on whether we have recent items
        if (this.recentHubs.length === 0 && this.recentPods.length === 0) {
            recentPodsSection.style.display = 'none';
            return;
        }

        recentPodsSection.style.display = 'block';

        // Clear existing list
        recentPodsList.innerHTML = '';

        // Use document fragment for better performance
        const fragment = document.createDocumentFragment();
        
        // Add hubs section if we have hubs
        if (this.recentHubs.length > 0) {
            this.recentHubs.forEach((hub) => {
                const hubElement = this.createHubElement(hub);
                fragment.appendChild(hubElement);
            });
        }
        
        // Add pods section if we have pods (only those without corresponding hub)
        if (this.recentPods.length > 0) {
            const podsHeader = document.createElement('h3');
            podsHeader.className = 'recent-section-header';
            podsHeader.textContent = 'Recent Pods';
            fragment.appendChild(podsHeader);

            this.recentPods.forEach((pod) => {
                const podElement = this.createPodElement(pod);
                fragment.appendChild(podElement);
            });
        }
        
        recentPodsList.appendChild(fragment);
        
        // Re-expand any hubs that were previously expanded, or expand the first hub if none were expanded
        const expandPromises = [];
        let hasExpandedHub = false;
        
        this.recentHubs.forEach((hub, index) => {
            if (this.expandedHubs.has(getRecordSpreadsheetId(hub))) {
                hasExpandedHub = true;
                const hubElement = recentPodsList.querySelector(`[data-hub-id="${getRecordSpreadsheetId(hub)}"]`);
                if (hubElement) {
                    // Clear the expanded state temporarily so toggleHubPods will expand it
                    this.expandedHubs.delete(getRecordSpreadsheetId(hub));
                    expandPromises.push(this.toggleHubPods(hub, hubElement));
                }
            }
        });
        
        // If no hubs were previously expanded, expand the first hub
        if (!hasExpandedHub && this.recentHubs.length > 0) {
            const firstHub = this.recentHubs[0];
            const firstHubElement = recentPodsList.querySelector(`[data-hub-id="${getRecordSpreadsheetId(firstHub)}"]`);
            if (firstHubElement) {
                expandPromises.push(this.toggleHubPods(firstHub, firstHubElement));
            }
        }
        
        // Wait for all expansions to complete
        if (expandPromises.length > 0) {
            Promise.all(expandPromises).catch(err => {
                console.warn('Error re-expanding hubs:', err);
            });
        }
    }

    /**
     * Create DOM element for a recent hub
     * @param {Object} hub - Hub data
     * @returns {HTMLElement} Hub element
     */
    createHubElement(hub) {
        const hubElement = document.createElement('div');
        hubElement.className = 'recent-pod-item recent-hub-item';
        hubElement.dataset.hubId = getRecordSpreadsheetId(hub); // Add identifier for tracking
        
        // Format date added time
        const dateAddedDate = new Date(hub.dateAdded);
        const addedTimeAgo = this.getTimeAgo(dateAddedDate);
        
        // Format last accessed time
        const lastAccessedDate = new Date(hub.lastAccessed);
        const lastOpenedTimeAgo = this.getTimeAgo(lastAccessedDate);

        hubElement.innerHTML = `
            <div class="recent-pod-info">
            <div class="recent-pod-name">
                <span class="hub-expand-icon">▶</span> 📅 ${this.parseHubTitle(hub.title)}
            </div>
            <div class="recent-pod-meta">
                <span>Added: ${addedTimeAgo}</span>
                <span class="separator"> • </span>
                <span>Last opened: ${lastOpenedTimeAgo}</span>
            </div>
            </div>
            <div class="hub-actions">
                <button class="hub-refresh-btn" title="Refresh hub data">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                </button>
                <button class="recent-pod-remove" title="Remove from recent">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
        `;

        // Add click handler for toggling hub pods
        const hubInfo = hubElement.querySelector('.recent-pod-info');
        hubInfo.addEventListener('click', async () => {
            await this.toggleHubPods(hub, hubElement);
        });

        // Add click handler for refreshing the hub
        const refreshBtn = hubElement.querySelector('.hub-refresh-btn');
        refreshBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.refreshHub(hub, hubElement);
        });

        // Add click handler for removing the hub
        const removeBtn = hubElement.querySelector('.recent-pod-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeRecentHub(getRecordSpreadsheetId(hub));
        });

        return hubElement;
    }

    /**
     * Create DOM element for a recent pod
     * @param {Object} pod - Pod data
     * @returns {HTMLElement} Pod element
     */
    createPodElement(pod) {
        const podElement = document.createElement('div');
        podElement.className = 'recent-pod-item';
        
        // Format date added time
        const dateAddedDate = new Date(pod.dateAdded);
        const addedTimeAgo = this.getTimeAgo(dateAddedDate);
        
        // Format last accessed time
        const lastAccessedDate = new Date(pod.lastAccessed);
        const lastOpenedTimeAgo = this.getTimeAgo(lastAccessedDate);

        podElement.innerHTML = `
            <div class="recent-pod-info">
                <div class="recent-pod-name">${this.escapeHtml(pod.title)}</div>
                <div class="recent-pod-meta">
                    <span>Added: ${addedTimeAgo}</span>
                    <span class="separator"> • </span>
                    <span>Last opened: ${lastOpenedTimeAgo}</span>
                </div>
            </div>
            <button class="recent-pod-remove" title="Remove from recent">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            </button>
        `;

        // Add click handler for loading the pod
        const podInfo = podElement.querySelector('.recent-pod-info');
        podInfo.addEventListener('click', () => {
            this.loadRecentPod(pod);
        });

        // Add click handler for removing the pod
        const removeBtn = podElement.querySelector('.recent-pod-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeRecentPod(getRecordSpreadsheetId(pod));
        });

        return podElement;
    }

    /**
     * Toggle the display of pods for a hub
     * @param {Object} hub - Hub data
     * @param {HTMLElement} hubElement - The hub DOM element
     */
    async toggleHubPods(hub, hubElement) {
        const hubSpreadsheetId = getRecordSpreadsheetId(hub);
        const expandIcon = hubElement.querySelector('.hub-expand-icon');
        
        // Check if this hub is already expanded
        if (this.expandedHubs.has(hubSpreadsheetId)) {
            // Collapse: remove the pods list
            this.expandedHubs.delete(hubSpreadsheetId);
            const podsList = hubElement.nextElementSibling;
            if (podsList && podsList.classList.contains('hub-pods-list')) {
                podsList.remove();
            }
            hubElement.classList.remove('expanded');
            if (expandIcon) expandIcon.textContent = '▶';
            return;
        }
        
        // Expand: load and show pods
        try {
            console.log(`🔄 Loading pods for hub: ${hub.title}`);
            hubElement.classList.add('loading');
            if (expandIcon) expandIcon.textContent = '⏳';
            
            // Get or create HubManager for this hub
            let hubManager = this.hubManagers.get(hubSpreadsheetId);
            if (!hubManager) {
                hubManager = new HubManager(hub.url);
                this.hubManagers.set(hubSpreadsheetId, hubManager);
            }
            
            // Load pods from the hub
            const pods = await hubManager.getPods();
            
            // Mark as expanded
            this.expandedHubs.add(hubSpreadsheetId);
            hubElement.classList.add('expanded');
            hubElement.classList.remove('loading');
            if (expandIcon) expandIcon.textContent = '▼';
            
            // Create and insert pods list
            const podsList = this.createHubPodsList(pods, hub);
            if (hubElement.parentNode) {
                hubElement.parentNode.insertBefore(podsList, hubElement.nextSibling);
                console.log(`✅ Loaded ${pods.length} pods for hub: ${hub.title}`);
            } else {
                console.warn('Hub element has no parent node, cannot insert pods list');
            }

            
        } catch (error) {
            console.error('Error loading hub pods:', error);
            hubElement.classList.remove('loading');
            if (expandIcon) expandIcon.textContent = '▶';
            // Show error message
            const errorMsg = document.createElement('div');
            errorMsg.className = 'hub-pods-error';
            errorMsg.textContent = `Error loading pods: ${error.message}`;
            hubElement.parentNode.insertBefore(errorMsg, hubElement.nextSibling);
            
            // Remove error after 3 seconds
            setTimeout(() => errorMsg.remove(), 3000);
        }
    }

    /**
     * Refresh hub data by forcing a re-download
     * @param {Object} hub - Hub data
     * @param {HTMLElement} hubElement - The hub DOM element
     */
    async refreshHub(hub, hubElement) {
        const hubSpreadsheetId = getRecordSpreadsheetId(hub);
        
        try {
            console.log(`🔄 Refreshing hub data: ${hub.title}`);
            
            // Add loading state
            const refreshBtn = hubElement.querySelector('.hub-refresh-btn');
            const originalIcon = refreshBtn.innerHTML;
            refreshBtn.classList.add('refreshing');
            refreshBtn.disabled = true;
            
            // Get or create HubManager for this hub
            let hubManager = this.hubManagers.get(hubSpreadsheetId);
            if (!hubManager) {
                hubManager = new HubManager(hub.url);
                this.hubManagers.set(hubSpreadsheetId, hubManager);
            }
            
            // Force reload by calling loadPods() directly
            await hubManager.loadPods();
            
            console.log(`✅ Hub data refreshed: ${hub.title}`);
            
            // If the hub is currently expanded, refresh the pods list
            if (this.expandedHubs.has(hubSpreadsheetId)) {
                const podsList = hubElement.nextElementSibling;
                if (podsList && podsList.classList.contains('hub-pods-list')) {
                    podsList.remove();
                }
                
                // Remove from expanded set temporarily so toggleHubPods will expand it
                this.expandedHubs.delete(hubSpreadsheetId);
                // Update the expand icon since we're collapsing
                const expandIcon = hubElement.querySelector('.hub-expand-icon');
                if (expandIcon) expandIcon.textContent = '▶';
                hubElement.classList.remove('expanded');
                
                // Re-expand with fresh data
                await this.toggleHubPods(hub, hubElement);
            }
            
            // Remove loading state
            refreshBtn.classList.remove('refreshing');
            refreshBtn.disabled = false;
            
        } catch (error) {
            console.error('Error refreshing hub:', error);
            
            // Remove loading state
            const refreshBtn = hubElement.querySelector('.hub-refresh-btn');
            if (refreshBtn) {
                refreshBtn.classList.remove('refreshing');
                refreshBtn.disabled = false;
            }
            
            // Show error message
            const errorMsg = document.createElement('div');
            errorMsg.className = 'hub-pods-error';
            errorMsg.textContent = `Error refreshing hub: ${error.message}`;
            hubElement.parentNode.insertBefore(errorMsg, hubElement.nextSibling);
            
            // Remove error after 3 seconds
            setTimeout(() => errorMsg.remove(), 3000);
        }
    }

    /**
     * Create a list of pods for a hub
     * @param {Array} pods - Array of pod objects from hub
     * @param {Object} hub - Hub data
     * @returns {HTMLElement} Pods list container
     */
    createHubPodsList(pods, hub) {
        const container = document.createElement('div');
        container.className = 'hub-pods-list';
        
        if (pods.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'hub-pods-empty';
            emptyMsg.textContent = 'No pods found in this hub';
            container.appendChild(emptyMsg);
            return container;
        }
        
        pods.forEach(pod => {
            const podItem = document.createElement('div');
            if (pod.sheetLink) {
                podItem.className = 'hub-pod-item';
                // Add click handler to load the pod
                podItem.addEventListener('click', () => {
                    this.loadHubPod(pod, hub);
                });
            } else {
                podItem.className = 'hub-pod-missing';
            }
            
            // Create status indicators
            const statusParts = [];
            if (!pod.sheetLink) {
                statusParts.push('<div class="hub-pod-status" title="Missing sheet link">🚫</div>');
            } else {
                if (pod.discrepancies > 0) {
                    const text = pod.discrepancies === 1 ? 'discrepancy' : 'discrepancies';
                    statusParts.push(`<div class="hub-pod-status" title="${pod.discrepancies} ${text}">⚠️ ${pod.discrepancies}</div>`);
                }
                if (pod.incompletes > 0) {
                    const text = pod.incompletes === 1 ? 'incomplete' : 'incompletes';
                    statusParts.push(`<div class="hub-pod-status" title="${pod.incompletes} ${text}">⏳ ${pod.incompletes}</div>`);
                }
            }
            
            const statusText = statusParts.length > 0 
                ? statusParts.join('')
                : '<div class="hub-pod-status-ok" title="Complete">✓</div>';

            podItem.innerHTML = `
                <div class="hub-pod-info">
                    <div class="hub-pod-name">${this.escapeHtml(pod.podName)}</div>
                    <div class="hub-pod-meta">${statusText}</div>
                </div>
            `;
            
            container.appendChild(podItem);
        });
        
        return container;
    }

    /**
     * Load a pod from a hub
     * @param {Object} pod - Pod data from hub
     * @param {Object} hub - Hub data
     */
    loadHubPod(pod, hub) {
        try {
            console.log(`🔄 Loading pod from hub: ${pod.podName}`);
            
            // Set the URL in the input field
            const urlInput = getElement('sheet-url');
            if (urlInput) {
                urlInput.value = pod.sheetLink;
            } else {
                console.warn('Sheet URL input element not found');
            }

            // Trigger the main load function
            const loadBtn = getElement('load-sheet-btn');
            if (loadBtn) {
                loadBtn.click();
            } else {
                console.warn('Load sheet button not found');
            }
        } catch (error) {
            console.error('Error loading hub pod:', error);
        }
    }

    /**
     * Load a recent pod with better error handling
     * @param {Object} pod - Pod data to load
     */
    loadRecentPod(pod) {
        try {
            console.log(`🔄 Loading recent pod: ${pod.title}`);
            
            // Add to recent pods to update lastAccessed timestamp
            this.addRecentPod(getRecordSpreadsheetId(pod), pod.title, pod.url);
            
            // Set the URL in the input field
            const urlInput = getElement('sheet-url');
            if (urlInput) {
                urlInput.value = pod.url;
            } else {
                console.warn('Sheet URL input element not found');
            }

            // Also trigger the main load function
            const loadBtn = getElement('load-sheet-btn');
            if (loadBtn) {
                loadBtn.click();
            } else {
                console.warn('Load sheet button not found');
            }
        } catch (error) {
            console.error('Error loading recent pod:', error);
        }
    }

    /**
     * Get human-readable time ago string with caching
     * @param {Date} date - Date to compare
     * @returns {string} Time ago string
     */
    getTimeAgo(date) {
        const timestamp = date.getTime();
        const cacheKey = `${timestamp}-${Math.floor(Date.now() / this.cacheExpiry)}`;
        
        // Check cache first
        if (this.timeAgoCache.has(cacheKey)) {
            return this.timeAgoCache.get(cacheKey);
        }
        
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let result;
        if (diffMins < 1) result = 'just now';
        else if (diffMins < 60) result = `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
        else if (diffHours < 24) result = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        else if (diffDays < 7) result = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        else result = date.toLocaleDateString();
        
        // Cache the result
        this.timeAgoCache.set(cacheKey, result);
        
        // Clean old cache entries periodically
        if (this.timeAgoCache.size > 100) {
            this.cleanTimeAgoCache();
        }
        
        return result;
    }

    /**
     * Clean expired cache entries
     */
    cleanTimeAgoCache() {
        const currentCacheKey = Math.floor(Date.now() / this.cacheExpiry);
        for (const [key] of this.timeAgoCache) {
            const cacheKeyFromEntry = key.split('-')[1];
            if (parseInt(cacheKeyFromEntry) < currentCacheKey) {
                this.timeAgoCache.delete(key);
            }
        }
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Parse hub title for display
     * If title contains ' - ' split and return first part, otherwise return whole
     * Always escape HTML before returning
     * @param {string} title
     * @returns {string}
     */
    parseHubTitle(title) {
        if (!title || typeof title !== 'string') return '';
        const parts = title.split(' - ');
        const primary = parts.length > 0 ? parts[0] : title;
        return this.escapeHtml(primary);
    }

    /**
     * Initialize recent pods display
     */
    async initialize() {
        // Load recent pods and hubs first
        if (!this.isInitialized) {
            // If user preferences not available, load from localStorage
            await Promise.all([
                this.loadRecentPods(),
                this.loadRecentHubs()
            ]);
        }
        this.renderRecentPods();
    }


}
