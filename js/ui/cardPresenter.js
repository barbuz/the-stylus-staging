/**
 * Card presenter.
 *
 * Loads and preloads Scryfall card images for the deck slots of the current and
 * adjacent matches, and hands the rendered slots to the view. It holds only the
 * image-loading concern; the controller decides which rows are worth preloading.
 */
import { logger } from '../utils/log.js';
export class CardPresenter {
    constructor(scryfallAPI, view) {
        this.scryfallAPI = scryfallAPI;
        this.view = view;
    }

    /** Render both players' cards for one row. */
    async loadPlayerCards(playerId, deckString) {
        const cardNames = this.scryfallAPI.parseDeckString(deckString);
        const slots = this.view.renderCardLoading(playerId, cardNames);

        try {
            const deckImages = await this.scryfallAPI.getDeckImages(deckString);
            this.view.renderCards(slots, deckImages, {
                getCardUrl: (name, exact) => this.scryfallAPI.getCardUrl(name, exact)
            });
        } catch (error) {
            logger.error(`Error loading cards for ${playerId}:`, error);
            this.view.renderCardError(slots);
        }
    }

    /** Warm the cache for the decks used by the given row indices. */
    preloadRows(rows, rowIndices) {
        const indices = Array.from(rowIndices);
        const decks = [];
        indices.forEach(index => {
            const row = rows[index];
            if (!row) {
                return;
            }
            if (row.player1 && row.player1.trim()) {
                decks.push(row.player1.trim());
            }
            if (row.player2 && row.player2.trim()) {
                decks.push(row.player2.trim());
            }
        });

        if (decks.length === 0) {
            return;
        }

        this.scryfallAPI.preloadCards(decks, { delay: 300, silent: true });
        logger.debug(`🔄 Started preloading cards for ${indices.length} matches (rows: ${indices.map(i => i + 1).join(', ')})`);
    }
}
