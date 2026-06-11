/**
 * Card Distributor - distributes cards across multiple Chrome instances
 * Example: 100 cards, 10 Chrome instances = 10 cards per instance
 */

class CardDistributor {
    constructor(accounts, cards, numChrome) {
        this.accounts = accounts || [];
        this.cards = cards || [];
        this.numChrome = numChrome || 1;
        this.chromeInstances = [];
        this.cardIndex = 0;

        this._initializeDistribution();
    }

    _initializeDistribution() {
        // Initialize Chrome instances first
        for (let i = 0; i < this.numChrome; i++) {
            this.chromeInstances.push({
                instanceId: i + 1,
                cards: [],
                cardsProcessed: 0,
                totalCards: 0,
                status: 'pending'
            });
        }

        // Distribute cards using ROUND-ROBIN
        // Card 1→Chrome 1, Card 2→Chrome 2, ..., Card 6→Chrome 1 (if 5 Chrome)
        this.cards.forEach((card, index) => {
            const chromeIndex = index % this.numChrome;
            this.chromeInstances[chromeIndex].cards.push(card);
        });

        // Update totalCards for each instance
        this.chromeInstances.forEach(instance => {
            instance.totalCards = instance.cards.length;
        });

        const cardsPerChrome = Math.ceil(this.cards.length / this.numChrome);
        console.log(`Đã chia ${this.cards.length} thẻ cho ${this.numChrome} Chrome (xoay vòng)`);
        console.log(`   Khoảng ${cardsPerChrome} thẻ mỗi Chrome`);
        this.chromeInstances.forEach(instance => {
            console.log(`   Chrome ${instance.instanceId}: ${instance.totalCards} thẻ`);
        });
    }

    /**
     * Get card queue for a specific Chrome instance
     * @param {number} instanceId - Chrome instance ID (1-based)
     * @returns {array} Array of card strings for this instance
     */
    getCardQueue(instanceId) {
        const instance = this.chromeInstances.find(i => i.instanceId === instanceId);
        if (!instance) {
            throw new Error(`Chrome instance ${instanceId} not found`);
        }
        return instance.cards;
    }

    /**
     * Get instance info (without account assignment)
     * @param {number} instanceId - Chrome instance ID (1-based)
     * @returns {object} Instance info
     */
    getInstanceInfo(instanceId) {
        const instance = this.chromeInstances.find(i => i.instanceId === instanceId);
        if (!instance) {
            throw new Error(`Chrome instance ${instanceId} not found`);
        }
        
        return {
            instanceId: instance.instanceId,
            totalCards: instance.totalCards,
            cardsProcessed: instance.cardsProcessed,
            cardsRemaining: instance.totalCards - instance.cardsProcessed,
            status: instance.status
        };
    }

    /**
     * Get next card for a specific instance
     * @param {number} instanceId - Chrome instance ID
     * @returns {object} Card info or null if no more cards
     */
    getNextCard(instanceId) {
        const instance = this.chromeInstances.find(i => i.instanceId === instanceId);
        if (!instance || instance.cardsProcessed >= instance.cards.length) {
            return null;
        }

        const card = instance.cards[instance.cardsProcessed];
        const cardData = card.split('|');

        return {
            number: cardData[0],
            month: cardData[1],
            year: cardData[2],
            cvc: cardData[3],
            name: cardData[4],
            instanceProgress: `${instance.cardsProcessed + 1}/${instance.totalCards}`
        };
    }

    /**
     * Mark a card as processed for an instance
     * @param {number} instanceId - Chrome instance ID
     */
    markCardProcessed(instanceId) {
        const instance = this.chromeInstances.find(i => i.instanceId === instanceId);
        if (instance) {
            instance.cardsProcessed++;
        }
    }

    /**
     * Update instance status
     * @param {number} instanceId - Chrome instance ID
     * @param {string} status - Status ('pending', 'processing', 'completed', 'error')
     */
    updateInstanceStatus(instanceId, status) {
        const instance = this.chromeInstances.find(i => i.instanceId === instanceId);
        if (instance) {
            instance.status = status;
        }
    }

    /**
     * Get overall progress
     * @returns {object} Progress statistics
     */
    getProgress() {
        const totalProcessed = this.chromeInstances.reduce((sum, i) => sum + i.cardsProcessed, 0);
        const totalCards = this.cards.length;

        return {
            totalCards,
            totalProcessed,
            percentComplete: totalCards > 0 ? Math.round((totalProcessed / totalCards) * 100) : 0,
            instances: this.chromeInstances.map(i => ({
                instanceId: i.instanceId,
                processed: i.cardsProcessed,
                total: i.totalCards,
                status: i.status
            }))
        };
    }

    /**
     * Get all instances info
     * @returns {array} All instances with their info
     */
    getAllInstances() {
        return this.chromeInstances.map(i => this.getInstanceInfo(i.instanceId));
    }
}

module.exports = CardDistributor;
