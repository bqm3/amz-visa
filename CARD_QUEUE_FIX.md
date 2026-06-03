# Card Queue Fix - Sequential Card Distribution

## Problem
Previously, cards were pre-split across Chrome instances using round-robin distribution. This could cause issues where multiple accounts were trying to add the same cards.

## Solution
Changed from per-Chrome card queues to a **shared sequential card queue** with `checkcard.txt` validation.

## Key Changes

### 1. Shared Card Queue
- **Before**: Each Chrome instance had its own pre-split card queue
- **After**: Single shared queue - all Chrome instances take cards sequentially

### 2. Card Assignment Flow
1. Chrome instance requests next card via `getNextCard()`
2. Check if card is in `checkcard.txt` → skip if yes
3. Check if card is in cardTracker → skip if yes  
4. Write card to `checkcard.txt` to "claim" it
5. Return card to Chrome instance for processing

### 3. checkcard.txt Integration
- File stores cards that have been claimed for processing
- Prevents duplicate card processing across Chrome instances
- Each card is written to `checkcard.txt` BEFORE being added to Amazon
- If card already exists in file, it's skipped

### 4. Sequential Processing
- Account 1 gets Card 1
- Account 2 gets Card 2
- Account 3 gets Card 3
- When Account 1 finishes, it gets Card 4
- And so on...

## Modified Files
- `src/util/checkCard.js`
  - Added `sharedCardQueue` and `sharedCardIndex`
  - Added `checkedCardsSet` for in-memory tracking
  - Added `loadCheckCardFile()`, `isCardInCheckFile()`, `writeCardToCheckFile()`
  - Added `getNextCard()` - main card distribution function
  - Updated `processCardQueue()` to use shared queue
  - Updated `saveRemainingCards()` and `updateRemainingCardCount()`
  - Removed `chromeCardQueues` array

## Benefits
1. ✅ Sequential card distribution across all accounts
2. ✅ No duplicate card processing
3. ✅ Automatic skip of already-processed cards
4. ✅ Better resource utilization
5. ✅ Persistent tracking via checkcard.txt
6. ✅ Graceful handling when accounts get locked

## Testing
To test:
1. Clear `src/data/checkcard.txt`
2. Add accounts to `src/data/acc.txt`
3. Add cards to `src/data/card.txt`
4. Click "Apply Config" with desired number of Chrome instances
5. Click "Scan Card"
6. Observe that each Chrome instance takes the next sequential card
7. Verify `checkcard.txt` is populated with processed cards
8. If stopped and restarted, cards in `checkcard.txt` are automatically skipped