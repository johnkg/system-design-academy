// Without the pattern: buttons change the document directly. No history, no undo.

const doc = { text: "" };

function onInsertClick(text) { doc.text += text; }
function onUppercaseClick() { doc.text = doc.text.toUpperCase(); }

onInsertClick("Hello");
onInsertClick(" world");
onUppercaseClick();
console.log(doc.text); // HELLO WORLD

// Undo? Nothing remembers what was done or what the text looked like before.
// Adding undo means editing every handler to save state in some ad-hoc way.
