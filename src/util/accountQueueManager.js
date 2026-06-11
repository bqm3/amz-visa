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

        console.app(`[Hàng đợi account] Đã khởi tạo ${this.availableAccounts.length} account khả dụng`);
        console.app(`[Hàng đợi account] Đã bỏ qua ${this.lockedAccounts.size} account bị khóa`);
        
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
                
                console.app(`[Hàng đợi account] Đã tải ${this.lockedAccounts.size} account bị khóa`);
            }
        } catch (err) {
            console.app(`[Hàng đợi account] Lỗi khi tải danh sách account bị khóa: ${err.message}`);
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
            console.app(`[Hàng đợi account] Chrome ${chromeId}: đã hết account khả dụng`);
            return null;
        }

        const account = this.availableAccounts.shift();
        this.processingAccounts.set(chromeId, account);
        
        const email = this.extractEmail(account);
        console.app(`[Hàng đợi account] Chrome ${chromeId}: nhận account ${email}`);
        
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
            console.app(`[Hàng đợi account] Chrome ${chromeId}: xử lý xong account ${email}`);
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
            
            console.app(`[Hàng đợi account] Chrome ${chromeId}: đánh dấu account bị khóa ${email}`);
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
            console.app(`[Hàng đợi account] Chrome ${chromeId}: đánh dấu account lỗi ${email}`);
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
            console.app(`[Hàng đợi account] Lỗi khi lưu account bị khóa: ${err.message}`);
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
