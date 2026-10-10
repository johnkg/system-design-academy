"""Keeping data and code apart in Python: parameterized queries and HTML encoding.
The "database" is only a printout here, so the focus stays on how the query is built."""
import json


# Unsafe: user input becomes part of the query text
def unsafe_query(name):
    return f"SELECT * FROM users WHERE name = '{name}'"


# Safe: the query text is fixed, and the value travels separately as data
def safe_query(name):
    return {"text": "SELECT * FROM users WHERE name = ?", "params": [name]}


attack = "' OR '1'='1"
print(f"unsafe, normal input: {unsafe_query('alice')}")
print(f"unsafe, attack input: {unsafe_query(attack)}")
safe = safe_query(attack)
params = ",".join(json.dumps(p) for p in safe["params"])
print(f"safe, attack input:   {safe['text']}  with params [{params}]")

# Column names cannot be parameters, so allow only known values
SORTABLE = {"name", "created"}


def order_by(column):
    return f"ORDER BY {column}" if column in SORTABLE else "ORDER BY name"


print(f"sort by created: {order_by('created')}")
print(f'sort by "name; DROP TABLE users": {order_by("name; DROP TABLE users")}')


# Output encoding for HTML text and attribute values
def escape_html(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


review = "<script>steal(document.cookie)</script>"
print(f"raw HTML:     <p>{review}</p>")
print(f"encoded HTML: <p>{escape_html(review)}</p>")
