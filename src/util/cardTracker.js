const fs = require('fs');
const path = require('path');

/**
 * Card Tracker
 * Manages which cards have been checked to avoid rechecking
 */
class CardTracker {
    constructor() {
        this.processedCards = new Set();
        this.failedCards = new Set();
        this.trackerFilePath = path.join(__dirname, '..', 'data', 'processed_cards.txt');
        this.loadProcessedCards();
    }

    /**
     * Load previously processed cards from file
     */
    loadProcessedCards() {
        try {
            if (fs.existsSync(this.trackerFilePath)) {
                const content = fs.readFileSync(this.trackerFilePath, 'utf8');
                const lines = content.split('\n').filter(line => line.trim());
                
                lines.forEach(line => {
                    // Format: "card|status|timestamp"
                    const parts = line.split('|');
                    if (parts.length >= 2) {
                        const card = parts[0].trim();
                        const status = parts[1].trim();
                        
                        if (status === 'CHECKED' || status === 'SUCCESS') {
                            this.processedCards.add(card);
                        } else if (status === 'FAILED') {
                            this.failedCards.add(card);
                        }
                    }
                });
                
                console.app(`[Theo dõi thẻ] Đã tải ${this.processedCards.size} thẻ đã xử lý`);
                console.app(`[Theo dõi thẻ] Đã tải ${this.failedCards.size} thẻ lỗi`);
            }
        } catch (err) {
            console.app(`[Theo dõi thẻ] Lỗi khi tải danh sách thẻ đã xử lý: ${err.message}`);
        }
    }

    /**
     * Check if a card has already been processed
     * @param {string} card - Card string
     * @returns {boolean} - True if card was already processed
     */
    isProcessed(card) {
        return this.processedCards.has(card.trim());
    }

    /**
     * Check if a card has failed
     * @param {string} card - Card string
     * @returns {boolean} - True if card was already failed
     */
    isFailed(card) {
        return this.failedCards.has(card.trim());
    }

    /**
     * Mark card as successfully processed
     * @param {string} card - Card string
     * @param {string} result - Result details (optional)
     */
    markAsProcessed(card, result = 'SUCCESS') {
        const cleanCard = card.trim();
        this.processedCards.add(cleanCard);
        this.failedCards.delete(cleanCard);
        this.saveCard(cleanCard, 'CHECKED', result);
        console.app(`[Theo dõi thẻ] Đã đánh dấu đã xử lý: ${cleanCard}`);
    }

    /**
     * Mark card as failed (couldn't process)
     * @param {string} card - Card string
     * @param {string} reason - Failure reason
     */
    markAsFailed(card, reason = 'UNKNOWN_ERROR') {
        const cleanCard = card.trim();
        this.failedCards.add(cleanCard);
        this.saveCard(cleanCard, 'FAILED', reason);
        console.app(`[Theo dõi thẻ] Đã đánh dấu lỗi: ${cleanCard} - ${reason}`);
    }

    /**
     * Save card tracking info to file
     */
    saveCard(card, status, details = '') {
        const timestamp = new Date().toISOString();
        const line = `${card}|${status}|${timestamp}|${details}\n`;
        
        try {
            fs.appendFileSync(this.trackerFilePath, line, 'utf8');
        } catch (err) {
            console.app(`[Theo dõi thẻ] Lỗi khi lưu thẻ: ${err.message}`);
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            processed: this.processedCards.size,
            failed: this.failedCards.size,
            total: this.processedCards.size + this.failedCards.size
        };
    }

    /**
     * Skip card (mark as skipped)
     * @param {string} card - Card string
     */
    markAsSkipped(card) {
        const cleanCard = card.trim();
        this.saveCard(cleanCard, 'SKIPPED', 'Đã xử lý trước đó');
        console.app(`[Theo dõi thẻ] Bỏ qua thẻ: ${cleanCard}`);
    }

    /**
     * Get all processed cards (for exporting)
     */
    getProcessedCards() {
        return Array.from(this.processedCards);
    }

    /**
     * Reset tracker (clear all processed records)
     */
    reset() {
        this.processedCards.clear();
        this.failedCards.clear();
        console.app(`[Theo dõi thẻ] Đã reset bộ theo dõi`);
    }
}

// Singleton instance
const cardTracker = new CardTracker();

module.exports = cardTracker;
