/**
 * Configuration Manager - handles global config state for UI input
 * Replaces file-based reading with in-memory config from UI
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor() {
        this.config = {
            accounts: [],
            cards: [],
            numChrome: 1,
            proxies: [],
            businessAccounts: [],
            source: 'ui' // 'ui' or 'file'
        };
        
        this._loadProxies();
        this._loadBusinessAccounts();
    }

    /**
     * Load proxies from file (still using file for proxies)
     */
    _loadProxies() {
        try {
            const proxiesPath = path.join(__dirname, "..", "data", 'proxies.txt');
            if (fs.existsSync(proxiesPath)) {
                const content = fs.readFileSync(proxiesPath, 'utf8');
                this.config.proxies = content
                    .replaceAll('\r', '')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
                console.log(`Đã tải ${this.config.proxies.length} proxy`);
            }
        } catch (err) {
            console.log(`Không thể tải proxy: ${err.message}`);
        }
    }

    /**
     * Load business accounts from data.json (still using file for reference)
     */
    _loadBusinessAccounts() {
        try {
            const dataPath = path.join(__dirname, "..", "data", 'data.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                this.config.businessAccounts = data.businessAccounts || [];
                console.log(`Đã tải ${this.config.businessAccounts.length} account business tham chiếu`);
            }
        } catch (err) {
            console.log(`Không thể tải danh sách account business: ${err.message}`);
        }
    }

    /**
     * Set configuration from UI input
     * @param {object} uiConfig - Configuration from UI dialog
     */
    setUIConfig(uiConfig) {
        if (uiConfig.accounts) {
            this.config.accounts = uiConfig.accounts.filter(acc => acc.trim().length > 0);
        }
        if (uiConfig.cards) {
            this.config.cards = uiConfig.cards.filter(card => card.trim().length > 0);
        }
        if (uiConfig.numChrome) {
            this.config.numChrome = uiConfig.numChrome;
        }
        
        this.config.source = 'ui';
        
        console.log(`Đã cập nhật cấu hình từ giao diện`);
        console.log(`   Account: ${this.config.accounts.length}`);
        console.log(`   Thẻ: ${this.config.cards.length}`);
        console.log(`   Số Chrome: ${this.config.numChrome}`);

        return this.config;
    }

    /**
     * Load configuration from files (fallback)
     */
    loadFromFiles() {
        try {
            const accPath = path.join(__dirname, "..", "data", 'acc.txt');
            const cardPath = path.join(__dirname, "..", "data", 'card.txt');

            if (fs.existsSync(accPath)) {
                const accContent = fs.readFileSync(accPath, 'utf8');
                this.config.accounts = accContent
                    .replaceAll('\r', '')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
                console.log(`Đã tải ${this.config.accounts.length} account từ acc.txt`);
            }

            if (fs.existsSync(cardPath)) {
                const cardContent = fs.readFileSync(cardPath, 'utf8');
                this.config.cards = cardContent
                    .replaceAll('\r', '')
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
                console.log(`Đã tải ${this.config.cards.length} thẻ từ card.txt`);
            }

            this.config.source = 'file';
            return this.config;
        } catch (err) {
            console.log(`Không thể tải cấu hình từ file: ${err.message}`);
            return null;
        }
    }

    /**
     * Get current configuration
     * @returns {object} Current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Get accounts
     * @returns {array} List of accounts
     */
    getAccounts() {
        return this.config.accounts;
    }

    /**
     * Get cards
     * @returns {array} List of cards
     */
    getCards() {
        return this.config.cards;
    }

    /**
     * Get number of Chrome instances
     * @returns {number} Number of Chrome instances
     */
    getNumChrome() {
        return this.config.numChrome;
    }

    /**
     * Get proxies
     * @returns {array} List of proxies
     */
    getProxies() {
        return this.config.proxies;
    }

    /**
     * Validate configuration
     * @returns {object} Validation result
     */
    validate() {
        const errors = [];

        if (!this.config.accounts || this.config.accounts.length === 0) {
            errors.push('Chưa cấu hình account');
        }

        if (!this.config.cards || this.config.cards.length === 0) {
            errors.push('Chưa cấu hình thẻ');
        }

        if (this.config.numChrome < 1) {
            errors.push('Số Chrome phải tối thiểu là 1');
        }

        // Validate account format
        this.config.accounts.forEach((acc, idx) => {
            const parts = acc.split('|');
            if (parts.length < 2) {
                errors.push(`Account ${idx + 1}: Sai định dạng, cần email|password|secret|code`);
            }
        });

        // Validate card format
        this.config.cards.forEach((card, idx) => {
            const parts = card.split('|');
            if (parts.length < 5) {
                errors.push(`Thẻ ${idx + 1}: Sai định dạng, cần number|month|year|cvv|name`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Save UI config to a temporary file for persistence
     */
    saveUIConfig() {
        try {
            const configPath = path.join(__dirname, "..", "data", 'ui_config.json');
            const configData = {
                timestamp: new Date().toISOString(),
                accounts: this.config.accounts,
                cards: this.config.cards,
                numChrome: this.config.numChrome
            };
            fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');
            console.log(`Đã lưu cấu hình giao diện vào ui_config.json`);
        } catch (err) {
            console.log(`Không thể lưu cấu hình giao diện: ${err.message}`);
        }
    }

    /**
     * Load previously saved UI config
     */
    loadSavedUIConfig() {
        try {
            const configPath = path.join(__dirname, "..", "data", 'ui_config.json');
            if (fs.existsSync(configPath)) {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                this.config.accounts = data.accounts || [];
                this.config.cards = data.cards || [];
                this.config.numChrome = data.numChrome || 1;
                this.config.source = 'ui';
                console.log(`Đã tải cấu hình giao diện đã lưu`);
                return true;
            }
        } catch (err) {
            console.log(`Không thể tải cấu hình giao diện đã lưu: ${err.message}`);
        }
        return false;
    }
}

// Global instance
let configManagerInstance = null;

function getConfigManager() {
    if (!configManagerInstance) {
        configManagerInstance = new ConfigManager();
    }
    return configManagerInstance;
}

module.exports = {
    ConfigManager,
    getConfigManager
};
