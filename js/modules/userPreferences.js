/**
 * User Preferences Manager
 * Handles storing user preferences (guru signature, recent pods) in Google appData
 */
import { CONFIG } from '../config.js';
import { logger } from '../utils/log.js';
import { getItem, setItem, removeItem } from '../services/storage.js';

export class UserPreferences {
    constructor() {
        this.preferencesFileName = 'the-stylus-preferences.json';
        this.preferencesFileId = null;
        this.isInitialized = false;
        this.cache = null;
        this.user = null;
    }

    /**
     * Initialize the preferences manager with user info
     * @param {Object} user - User object from Google auth
     */
    async initialize(user) {
        this.user = user;
        this.isInitialized = true;

        try {
            // Try to find existing preferences file
            await this.findOrCreatePreferencesFile();

            // Load preferences from appData
            const preferences = await this.loadPreferences();

            logger.debug('✅ User preferences initialized');
            return preferences;
        } catch (error) {
            logger.error('Error initializing user preferences:', error);
            // Fall back to localStorage if appData fails
            return this.loadFromLocalStorage();
        }
    }

    /**
     * Find existing preferences file or create new one
     */
    async findOrCreatePreferencesFile() {
        try {
            // Search for preferences file
            const response = await gapi.client.drive.files.list({
                q: `name='${this.preferencesFileName}' and parents in 'appDataFolder' and trashed=false`,
                spaces: 'appDataFolder'
            });

            if (response.result.files && response.result.files.length > 0) {
                this.preferencesFileId = response.result.files[0].id;
                logger.debug('📄 Found existing preferences file:', this.preferencesFileId);
                return;
            }

            // No file found, create new one
            await this.createPreferencesFile();
        } catch (error) {
            logger.error('Error finding/creating preferences file:', error);
            throw error;
        }
    }

    /**
     * Create new preferences file in Google appData
     */
    async createPreferencesFile() {
        try {
            const defaultPreferences = {
                guruSignature: '',
                recentPods: [],
                recentHubs: [],
                version: '1.0.0',
                lastUpdated: new Date().toISOString()
            };

            const fileMetadata = {
                name: this.preferencesFileName,
                parents: ['appDataFolder'] // Store in app-specific hidden folder
            };

            const response = await gapi.client.request({
                path: 'https://www.googleapis.com/upload/drive/v3/files',
                method: 'POST',
                params: {
                    uploadType: 'multipart'
                },
                headers: {
                    'Content-Type': 'multipart/related; boundary="foo_bar_baz"'
                },
                body: this.createMultipartBody(fileMetadata, JSON.stringify(defaultPreferences, null, 2))
            });

            this.preferencesFileId = response.result.id;
            this.cache = defaultPreferences;

            logger.debug('📄 Created new preferences file:', this.preferencesFileId);
        } catch (error) {
            logger.error('Error creating preferences file:', error);
            throw error;
        }
    }

    /**
     * Create multipart body for file upload
     */
    createMultipartBody(metadata, data) {
        const delimiter = 'foo_bar_baz';
        const close_delim = `\r\n--${delimiter}--`;

        let body = '--' + delimiter + '\r\n';
        body += 'Content-Type: application/json\r\n\r\n';
        body += JSON.stringify(metadata) + '\r\n';
        body += '--' + delimiter + '\r\n';
        body += 'Content-Type: application/json\r\n\r\n';
        body += data;
        body += close_delim;

        return body;
    }

    /**
     * Load preferences from a specific file ID
     * @param {string} fileId - The file ID to load from
     */
    async loadPreferencesFromFile(fileId) {
        try {
            const response = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });

            const preferences = JSON.parse(response.body);

            logger.debug('📥 Loaded preferences from appData:', {
                guruSignature: preferences.guruSignature,
                recentPodsCount: preferences.recentPods?.length || 0,
                recentHubsCount: preferences.recentHubs?.length || 0,
                lastUpdated: preferences.lastUpdated
            });

            this.cache = preferences;

            // Also save to localStorage for faster subsequent loads
            this.saveToLocalStorage(preferences);

            return preferences;
        } catch (error) {
            logger.error('Error loading preferences from file:', error);
            throw error;
        }
    }

    /**
     * Load preferences from Google appData
     * Uses stale-while-revalidate: returns cached data immediately,
     * then fetches fresh data in background
     */
    async loadPreferences() {
        if (!this.preferencesFileId) {
            throw new Error('No preferences file ID available');
        }

        // If we have cached data, return it immediately
        const cachedData = this.loadFromLocalStorage();
        if (cachedData) {
            logger.debug('⚡ Returning cached preferences (revalidating in background)');
            this.cache = cachedData;

            // Fetch fresh data in background
            this.loadPreferencesFromFile(this.preferencesFileId)
                .then(freshData => {
                    // Update cache silently
                    this.cache = freshData;
                    this.saveToLocalStorage(freshData);
                    logger.debug('🔄 Background refresh of preferences file complete');
                })
                .catch(error => {
                    logger.warn('Background refresh of preferences file failed, keeping cached data:', error);
                });

            return cachedData;
        }

        // No cache, fetch normally
        logger.debug('📥 Loading preferences from appData');
        return await this.loadPreferencesFromFile(this.preferencesFileId);
    }

    /**
     * Save preferences to Google appData
     */
    async savePreferences(preferences) {
        // Save to local storage first
        this.saveToLocalStorage(preferences);
        if (!this.preferencesFileId) {
            throw new Error('No preferences file ID available');
        }

        try {
            // Update timestamp
            preferences.lastUpdated = new Date().toISOString();

            const response = await gapi.client.request({
                path: `https://www.googleapis.com/upload/drive/v3/files/${this.preferencesFileId}`,
                method: 'PATCH',
                params: {
                    uploadType: 'media'
                },
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(preferences, null, 2)
            });

            this.cache = preferences;

            logger.debug('💾 Saved preferences to appData');
            return response;
        } catch (error) {
            logger.error('Error saving preferences to appData:', error);
            throw error;
        }
    }

    /**
     * Get guru signature
     */
    async getGuruSignature() {
        if (!this.isInitialized) {
            return getItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE) || '';
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }
            return this.cache.guruSignature || '';
        } catch (error) {
            logger.error('Error getting guru signature from appData:', error);
            return getItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE) || '';
        }
    }

    /**
     * Set guru signature
     */
    async setGuruSignature(signature) {
        if (!this.isInitialized) {
            setItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE, signature);
            return;
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }

            if (this.cache.guruSignature !== signature) {
                this.cache.guruSignature = signature;
                await this.savePreferences(this.cache);

            }
            // Also update localStorage as backup
            setItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE, signature);
        } catch (error) {
            logger.error('Error setting guru signature in appData:', error);
            // Fall back to localStorage
            setItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE, signature);
        }
    }

    /**
     * Get recent pods
     */
    async getRecentPods() {
        if (!this.isInitialized) {
            const stored = getItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
            return stored ? JSON.parse(stored) : [];
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }
            return this.cache.recentPods || [];
        } catch (error) {
            logger.error('Error getting recent pods from appData:', error);
            const stored = getItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
            return stored ? JSON.parse(stored) : [];
        }
    }

    /**
     * Set recent pods
     */
    async setRecentPods(pods) {
        if (!this.isInitialized) {
            setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(pods));
            return;
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }

            this.cache.recentPods = pods;
            await this.savePreferences(this.cache);

            // Also update localStorage as backup
            setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(pods));
        } catch (error) {
            logger.error('Error setting recent pods in appData:', error);
            // Fall back to localStorage
            setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(pods));
        }
    }

    /**
     * Get recent hubs
     */
    async getRecentHubs() {
        if (!this.isInitialized) {
            const stored = getItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);
            return stored ? JSON.parse(stored) : [];
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }
            return this.cache.recentHubs || [];
        } catch (error) {
            logger.error('Error getting recent hubs from appData:', error);
            const stored = getItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);
            return stored ? JSON.parse(stored) : [];
        }
    }

    /**
     * Set recent hubs
     */
    async setRecentHubs(hubs) {
        if (!this.isInitialized) {
            setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(hubs));
            return;
        }

        try {
            if (!this.cache) {
                await this.loadPreferences();
            }

            this.cache.recentHubs = hubs;
            await this.savePreferences(this.cache);

            // Also update localStorage as backup
            setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(hubs));
        } catch (error) {
            logger.error('Error setting recent hubs in appData:', error);
            // Fall back to localStorage
            setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(hubs));
        }
    }

    /**
     * Load preferences from localStorage (fallback)
     * Returns null if no data is found in localStorage
     */
    loadFromLocalStorage() {
        const guruSignature = getItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE);
        const recentPodsStr = getItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
        const recentHubsStr = getItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);

        // Return null if no data exists in localStorage
        if (!guruSignature && !recentPodsStr && !recentHubsStr) {
            logger.debug('📭 No cached preferences in localStorage');
            return null;
        }

        // Start from the last appData snapshot so keys this build does not know
        // about (e.g. written by a newer preview build) survive a round trip
        // through this localStorage fallback instead of being dropped.
        const preferences = {
            ...(this.cache || {}),
            guruSignature: guruSignature || '',
            recentPods: recentPodsStr ? JSON.parse(recentPodsStr) : [],
            recentHubs: recentHubsStr ? JSON.parse(recentHubsStr) : [],
            version: '1.0.0',
            lastUpdated: new Date().toISOString()
        };
        logger.debug('📥 Loaded preferences from localStorage:', preferences);
        return preferences;
    }

    /**
     * Save preferences to localStorage (fallback)
     */
    saveToLocalStorage(preferences) {
        if (preferences.guruSignature) {
            setItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE, preferences.guruSignature);
        }
        if (preferences.recentPods) {
            setItem(CONFIG.STORAGE_KEYS.RECENT_PODS, JSON.stringify(preferences.recentPods));
        }
        if (preferences.recentHubs) {
            setItem(CONFIG.STORAGE_KEYS.RECENT_HUBS, JSON.stringify(preferences.recentHubs));
        }
    }

    /**
     * Clear all preferences (both appData and localStorage)
     */
    async clearAllPreferences() {
        try {
            if (this.preferencesFileId && this.isInitialized) {
                // Clear appData preferences
                const emptyPreferences = {
                    guruSignature: '',
                    recentPods: [],
                    recentHubs: [],
                    version: '1.0.0',
                    lastUpdated: new Date().toISOString()
                };

                await this.savePreferences(emptyPreferences);
            }
        } catch (error) {
            logger.error('Error clearing appData preferences:', error);
        }

        // Clear localStorage
        removeItem(CONFIG.STORAGE_KEYS.GURU_SIGNATURE);
        removeItem(CONFIG.STORAGE_KEYS.RECENT_PODS);
        removeItem(CONFIG.STORAGE_KEYS.RECENT_HUBS);

        logger.debug('🗑️ Cleared all preferences');
    }
}
