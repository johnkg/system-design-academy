# Without the pattern: buttons change the document directly. No history, no undo.

doc = {"text": ""}


def on_insert_click(text):
    doc["text"] += text


def on_uppercase_click():
    doc["text"] = doc["text"].upper()


on_insert_click("Hello")
on_insert_click(" world")
on_uppercase_click()
print(doc["text"])  # HELLO WORLD

# Undo? Nothing remembers what was done or what the text looked like before.
# Adding undo means editing every handler to save state in some ad-hoc way.
