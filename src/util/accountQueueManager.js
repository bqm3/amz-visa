const fs = require('fs');
const path = require('path');

/**
 * Account Queue Manager
 * Manages account distribution across Chrome instances with dynamic rotation
 */
class AccountQueueManager {
    constructor() {
        this.availableAccounts = [];
        this.lockedAccounts = new Set();
        this.processingAccounts = new Map(); // chromeId -> account
        this.completedAccounts = new Set();
        this.failedAccounts = new Set();
    }

    /**
     * Initialize the queue with accounts from acc.txt, filtering out locked ones
     */
    initialize(accounts) {
        // Load locked accounts from file
        this.loadLockedAccounts();
        
        // Filter out locked accounts
        this.availableAccounts = accounts.filter(acc => {
            const email = this.extractEmail(acc);
            return !this.lockedAccounts.has(email);
        });

        console.app(`[AccountQueue] Initialized with ${this.availableAccounts.length} available accounts`);
        console.app(`[AccountQueue] Filtered out ${this.lockedAccounts.size} locked accounts`);
        
        return this.availableAccounts.length;
    }

    /**
     * Load locked accounts from locked_accounts.txt
     */
    loadLockedAccounts() {
        const lockedFilePath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');
        
        try {
            if (fs.existsSync(lockedFilePath)) {
                const content = fs.readFileSync(lockedFilePath, 'utf8');
                const lines = content.split('\n').filter(line => line.trim());
                
                lines.forEach(line => {
                    // Format: "timestamp: email - status - action"
                    const emailMatch = line.match(/:\s*([^\s]+@[^\s]+)\s*-/);
                    if (emailMatch) {
                        this.lockedAccounts.add(emailMatch[1].trim());
                    }
                });
                
                console.app(`[AccountQueue] Loaded ${this.lockedAccounts.size} locked accounts`);
            }
        } catch (err) {
            console.app(`[AccountQueue] Error loading locked accounts: ${err.message}`);
        }
    }

    /**
     * Extract email from account string (format: email|password)
     */
    extractEmail(accountString) {
        return accountString.split('|')[0].trim();
    }

    /**
     * Get next available account for a Chrome instance
     * @param {number} chromeId - Chrome instance ID
     * @returns {string|null} - Account string or null if no accounts available
     */
    getNextAccount(chromeId) {
        if (this.availableAccounts.length === 0) {
            console.app(`[AccountQueue] No more accounts available for Chrome ${chromeId}`);
            return null;
        }

        const account = this.availableAccounts.shift();
        this.processingAccounts.set(chromeId, account);
        
        const email = this.extractEmail(account);
        console.app(`[AccountQueue] Chrome ${chromeId} assigned account: ${email}`);
        
        return account;
    }

    /**
     * Mark account as completed (successfully processed)
     * @param {number} chromeId - Chrome instance ID
     */
    markAccountCompleted(chromeId) {
        const account = this.processingAccounts.get(chromeId);
        if (account) {
            const email = this.extractEmail(account);
            this.completedAccounts.add(email);
            this.processingAccounts.delete(chromeId);
            console.app(`[AccountQueue] Chrome ${chromeId} completed account: ${email}`);
        }
    }

    /**
     * Mark account as locked
     * @param {number} chromeId - Chrome instance ID
     */
    markAccountLocked(chromeId) {
        const account = this.processingAccounts.get(chromeId);
        if (account) {
            const email = this.extractEmail(account);
            this.lockedAccounts.add(email);
            this.processingAccounts.delete(chromeId);
            
            // Save to locked_accounts.txt
            this.saveLockedAccount(email);
            
            console.app(`[AccountQueue] Chrome ${chromeId} marked account as locked: ${email}`);
        }
    }

    /**
     * Mark account as failed (cannot continue but not locked)
     * @param {number} chromeId - Chrome instance ID
     */
    markAccountFailed(chromeId) {
        const account = this.processingAccounts.get(chromeId);
        if (account) {
            const email = this.extractEmail(account);
            this.failedAccounts.add(email);
            this.processingAccounts.delete(chromeId);
            console.app(`[AccountQueue] Chrome ${chromeId} marked account as failed: ${email}`);
        }
    }

    /**
     * Save locked account to locked_accounts.txt
     */
    saveLockedAccount(email) {
        const lockedFilePath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');
        const timestamp = new Date().toISOString();
        const line = `${timestamp}: ${email} - ACCOUNT_LOCKED - AUTO_DETECTED\n`;
        
        try {
            fs.appendFileSync(lockedFilePath, line, 'utf8');
        } catch (err) {
            console.app(`[AccountQueue] Error saving locked account: ${err.message}`);
        }
    }

    /**
     * Get current account for a Chrome instance
     */
    getCurrentAccount(chromeId) {
        return this.processingAccounts.get(chromeId);
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            available: this.availableAccounts.length,
            processing: this.processingAccounts.size,
            completed: this.completedAccounts.size,
            locked: this.lockedAccounts.size,
            failed: this.failedAccounts.size
        };
    }

    /**
     * Check if there are more accounts to process
     */
    hasMoreAccounts() {
        return this.availableAccounts.length > 0;
    }

    /**
     * Reset the queue (for restarting)
     */
    reset() {
        this.availableAccounts = [];
        this.processingAccounts.clear();
        this.completedAccounts.clear();
        this.failedAccounts.clear();
        // Keep locked accounts loaded
    }
}

// Singleton instance
const accountQueue = new AccountQueueManager();

module.exports = accountQueue;