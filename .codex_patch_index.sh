#!/usr/bin/env bash
apply_patch "$(cat <<'PATCH'
*** Begin Patch
*** Update File: src/index.js
@@
-const today = new Date();
-const formattedDate = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
+const today = new Date();
+const localYear = today.getFullYear();
+const localMonth = String(today.getMonth() + 1).padStart(2, "0");
+const localDay = String(today.getDate()).padStart(2, "0");
+const formattedDate = `${localYear}-${localMonth}-${localDay}`; // Local date: YYYY-MM-DD
@@
-    cardLiveTitle.addEventListener('clicked', () => {
-        const cardLiveTitle = path.join(__dirname, "data", 'live.txt');
+    cardLiveTitle.addEventListener('clicked', () => {
+        const liveFilePath = path.join(dirSave, 'live.txt');
 
-        exec(`notepad "${cardLiveTitle}"`, (err) => {
+        exec(`notepad "${liveFilePath}"`, (err) => {
             if (err) {
                 appendToTerminal(terminal.toPlainText() + "\nError opening live.txt: " + err.message);
             }
         });
     });
@@
-    cardDieTitle.addEventListener('clicked', () => {
-        const cardDieTitle = path.join(__dirname, "data", 'die.txt');
+    cardDieTitle.addEventListener('clicked', () => {
+        const dieFilePath = path.join(dirSave, 'die.txt');
 
-        exec(`notepad "${cardDieTitle}"`, (err) => {
+        exec(`notepad "${dieFilePath}"`, (err) => {
             if (err) {
                 appendToTerminal(terminal.toPlainText() + "\nError opening die.txt: " + err.message);
             }
         });
     });    
*** End Patch
PATCH
)"
