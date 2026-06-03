const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const checkCardFilePath = path.join(dataDir, 'checkcard.txt');

let queue = [];
let initialized = false;
let checkedCards = new Set();

function normalizeCardLine(cardLine) {
    const [numberRaw, monthRaw, yearRaw, cvcRaw, ...nameParts] = String(cardLine || '').split('|');
    if (!numberRaw || !monthRaw || !yearRaw || !cvcRaw) return null;

    const number = numberRaw.replace(/\D/g, '').trim();
    if (!number) return null;

    const monthNumber = Number(String(monthRaw).trim());
    const month = Number.isFinite(monthNumber) && monthNumber > 0
        ? String(monthNumber).padStart(2, '0')
        : String(monthRaw).trim();
    const yearRawTrimmed = String(yearRaw).trim();
    const year = yearRawTrimmed.length === 2 ? `20${yearRawTrimmed}` : yearRawTrimmed;
    const cvc = String(cvcRaw).trim();
    const name = nameParts.join('|').trim() || 'Saint David';

    return {
        number,
        month,
        year,
        cvc,
        name,
        raw: String(cardLine || '').trim(),
        key: `${number}|${month}|${year}|${cvc}`
    };
}

function cardKey(cardLineOrCard) {
    if (cardLineOrCard && typeof cardLineOrCard === 'object' && cardLineOrCard.key) {
        return cardLineOrCard.key;
    }
    const card = normalizeCardLine(cardLineOrCard);
    return card ? card.key : String(cardLineOrCard || '').trim();
}

function loadCheckedCards() {
    checkedCards = new Set();
    try {
        if (!fs.existsSync(checkCardFilePath)) return;
        const lines = fs.readFileSync(checkCardFilePath, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        for (const line of lines) {
            checkedCards.add(line);
            checkedCards.add(cardKey(line));
        }
    } catch (error) {
        console.log(`Could not load checkcard.txt: ${error.message}`);
    }
}

function initialize(cardLines, force = false) {
    if (initialized && !force) return;

    loadCheckedCards();
    queue = (cardLines || [])
        .map(normalizeCardLine)
        .filter(Boolean);
    initialized = true;

    console.app(`Shared card queue initialized: ${queue.length} card(s), ${checkedCards.size} checked key(s)`);
}

function claimNextCard(owner = '') {
    while (queue.length > 0) {
        const card = queue.shift();

        if (checkedCards.has(card.key)) {
            console.app(`Skip card ***${card.number.slice(-4)} because it is already in checkcard.txt`);
            continue;
        }

        checkedCards.add(card.key);
        fs.appendFileSync(checkCardFilePath, `${card.key}\n`, 'utf8');
        console.app(`CLAIM card ***${card.number.slice(-4)}${owner ? ` for ${owner}` : ''}`);
        return card;
    }

    return null;
}

function remainingCount() {
    return queue.length;
}

module.exports = {
    initialize,
    claimNextCard,
    remainingCount,
    normalizeCardLine
};
