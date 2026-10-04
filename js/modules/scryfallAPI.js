/**
 * Scryfall API Service
 * Handles fetching card images from Scryfall API
 * Implements rate limiting as per Scryfall guidelines (50-100ms delay between requests)
 */
import { logger } from '../utils/log.js';
export class ScryfallAPI {
    constructor() {
        this.baseUrl = 'https://api.scryfall.com';
        this.cache = new Map(); // Cache loaded Image objects to avoid duplicate requests
        this.lastRequestTime = 0;
        this.rateLimitDelay = 75; // 75ms delay between requests (within 50-100ms guideline)
        this.preloadQueue = new Set(); // Track cards being preloaded to avoid duplicates
        this.isPreloading = false; // Flag to track if preloading is in progress
    }

    /**
     * Get the Scryfall search URL for a specific card name
     * @param {string} cardName - The exact name of the card
     * @returns {string} Scryfall URL for the card
     * */
    getCardUrl(cardName, exactMatch = true) {
        if (exactMatch) {
            return `https://scryfall.com/search?q=!${encodeURIComponent('"' + cardName + '"')}`;
        } else {
            return `https://scryfall.com/search?q=${encodeURIComponent(cardName)}`;
        }
    }

    /**
     * Enforce rate limiting by waiting between requests
     * Ensures 50-100ms delay between API requests to respect Scryfall guidelines
     */
    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.rateLimitDelay) {
            const waitTime = this.rateLimitDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * Parse deck string and extract individual card names
     * @param {string} deckString - Cards separated by pipes (e.g., "Card 1 | Card 2 | Card 3")
     * @returns {string[]} Array of card names
     */
    parseDeckString(deckString) {
        if (!deckString || typeof deckString !== 'string') {
            return [];
        }

        return deckString
            .split('|')
            .map(cardName => cardName.trim())
            .filter(cardName => cardName.length > 0);
    }

    /**
     * Get card image from Scryfall API
     * @param {string} cardName - The exact name of the card
     * @returns {Promise<Image>} Loaded Image object
     */
    async getCardImage(cardName) {
        if (!cardName || cardName.trim() === '') {
            throw new Error('Card name is required');
        }

        const trimmedName = cardName.trim();

        // Check cache first - if we have the image cached, return it directly
        if (this.cache.has(trimmedName)) {
            // Return a copy of the cached image to avoid mutation
            const cachedImage = this.cache.get(trimmedName);
            return cachedImage.cloneNode();
        }

        try {
            // Enforce rate limiting before making API request
            await this.enforceRateLimit();

            const encodedName = encodeURIComponent(trimmedName);
            const imageUrl = `${this.baseUrl}/cards/named?exact=${encodedName}&format=image&version=normal`;

            // Load and cache the actual image
            const loadedImage = await this.loadAndCacheImage(trimmedName, imageUrl);

            return loadedImage;
        } catch (error) {
            logger.warn(`Failed to get image for card "${trimmedName}":`, error);
            throw new Error(`Card "${trimmedName}" not found`);
        }
    }

    /**
     * Load an image and return the loaded Image object
     * @param {string} name - Name of the card (for caching purposes)
     * @param {string} url - Image URL to load
     * @returns {Promise<Image>} Loaded Image object
     */
    async loadAndCacheImage(name, url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous'; // Enable CORS for cross-origin images
            img.src = url;
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image not found'));
            this.cache.set(name, img); // Cache the image immediately
        });
    }

    /**
     * Validate that an image URL can be loaded (legacy method, now using loadAndCacheImage)
     * @param {string} url - Image URL to validate
     * @returns {Promise<void>}
     */
    async validateImageUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image not found'));
            img.src = url;
        });
    }

    /**
     * Get card images for an entire deck
     * @param {string} deckString - Deck string with cards separated by pipes
     * @returns {Promise<Array<{cardName: string, imageUrl?: string, image?: Image, error?: string}>>}
     */
    async getDeckImages(deckString) {
        const cardNames = this.parseDeckString(deckString);

        if (cardNames.length === 0) {
            return [];
        }

        // Process cards sequentially to respect rate limits
        // Using Promise.allSettled could overwhelm the API with simultaneous requests
        const results = [];
        for (const cardName of cardNames) {
            try {
                const loadedImage = await this.getCardImage(cardName);
                results.push({
                    cardName,
                    imageUrl: loadedImage.src,
                    image: loadedImage
                });
            } catch (error) {
                results.push({ cardName, error: error.message });
            }
        }

        return results;
    }

    /**
     * Pre-load card images in the background for future use
     * This runs at a slower pace to not interfere with immediate requests
     * @param {string|string[]} deckString - Deck string or array of card names to preload
     * @param {object} options - Preload options
     * @param {number} options.delay - Additional delay between preload requests (default: 200ms)
     * @param {boolean} options.silent - Don't log preload progress (default: true)
     * @returns {Promise<void>}
     */
    async preloadCards(deckString, options = {}) {
        const { delay = 200, silent = true } = options;

        // Parse deck string to get card names
        const cardNames = Array.isArray(deckString)
            ? deckString.flatMap(deck => this.parseDeckString(deck)) // Parse each deck string in the array
            : this.parseDeckString(deckString);

        if (cardNames.length === 0) {
            return;
        }

        // Filter out cards that are already cached or being preloaded
        const cardsToPreload = cardNames.filter(cardName => {
            const trimmedName = cardName.trim();
            return !this.cache.has(trimmedName) && !this.preloadQueue.has(trimmedName);
        });

        if (cardsToPreload.length === 0) {
            if (!silent) logger.debug('🎯 All cards already cached or queued for preload');
            return;
        }

        // Add cards to preload queue
        cardsToPreload.forEach(cardName => this.preloadQueue.add(cardName.trim()));

        if (!silent) logger.debug(`🔄 Starting background preload for ${cardsToPreload.length} cards`);

        // Start preloading if not already in progress
        if (!this.isPreloading) {
            this.isPreloading = true;
            this._processPreloadQueue(delay, silent);
        }
    }

    /**
     * Process the preload queue in the background
     * @private
     * @param {number} delay - Delay between requests
     * @param {boolean} silent - Silent mode
     */
    async _processPreloadQueue(delay, silent) {
        while (this.preloadQueue.size > 0) {
            const cardName = this.preloadQueue.values().next().value;
            this.preloadQueue.delete(cardName);

            try {
                // Check if card was cached while in queue
                if (this.cache.has(cardName)) {
                    continue;
                }

                // Use longer delay for preloading to be less aggressive
                await this.enforceRateLimit();
                await new Promise(resolve => setTimeout(resolve, delay));

                const encodedName = encodeURIComponent(cardName);
                const imageUrl = `${this.baseUrl}/cards/named?exact=${encodedName}&format=image&version=normal`;

                // For preloading, load and cache the actual image
                const loadedImage = await this.loadAndCacheImage(cardName, imageUrl);

                if (!silent) logger.debug(`✅ Preloaded: ${cardName}`);

            } catch (error) {
                if (!silent) logger.warn(`⚠️ Failed to preload "${cardName}":`, error.message);
                // Don't cache failed preloads, let them be retried on actual request
            }
        }

        this.isPreloading = false;
        if (!silent) logger.debug('🎯 Background preloading completed');
    }

    /**
     * Stop current preloading process and clear the queue
     */
    stopPreloading() {
        this.preloadQueue.clear();
        this.isPreloading = false;
        logger.debug('🛑 Preloading stopped and queue cleared');
    }

    /**
     * Get preload status
     * @returns {object} Preload status info
     */
    getPreloadStatus() {
        return {
            isPreloading: this.isPreloading,
            queueSize: this.preloadQueue.size,
            queuedCards: Array.from(this.preloadQueue)
        };
    }
}
