# Without the pattern: the client checks types and recurses by hand.

project = {
    "name": "project",
    "children": [
        {"name": "readme.md", "size": 10},
        {"name": "src", "children": [
            {"name": "app.js", "size": 40},
            {"name": "util.js", "size": 15},
        ]},
    ],
}


def total_size(item):
    if "children" in item:  # is it a folder?
        return sum(total_size(c) for c in item["children"])
    return item["size"]  # or a file?


print(total_size(project))
# Every feature (print, search, delete...) repeats this type check and recursion.
# A new kind of item, like a shortcut, must be added to every one of them.
