"""Offset and cursor pagination in Python, with a new post arriving between two page loads."""


class PostStore:
    def __init__(self, count):
        self.posts = [{"id": i} for i in range(count, 0, -1)]  # newest first

    def add(self):
        self.posts.insert(0, {"id": self.posts[0]["id"] + 1})

    # OFFSET n LIMIT m: skip rows, then take some
    def by_offset(self, offset, limit):
        return [p["id"] for p in self.posts[offset:offset + limit]]

    # WHERE id < cursor LIMIT m: continue after the last id the client saw
    def by_cursor(self, cursor, limit):
        rows = [p["id"] for p in self.posts if cursor is None or p["id"] < cursor][:limit]
        return {"ids": rows, "next": rows[-1] if rows else None}


def join(ids):
    return ",".join(map(str, ids))


LIMIT = 5

offset_store = PostStore(20)
print("offset pagination")
print(f"  page 1: {join(offset_store.by_offset(0, LIMIT))}")
offset_store.add()  # post 21 is published while the client reads
print(f"  page 2: {join(offset_store.by_offset(LIMIT, LIMIT))}   <- 16 appears again")

cursor_store = PostStore(20)
print("cursor pagination")
first = cursor_store.by_cursor(None, LIMIT)
print(f"  page 1: {join(first['ids'])}")
cursor_store.add()  # the same new post
second = cursor_store.by_cursor(first["next"], LIMIT)
print(f"  page 2: {join(second['ids'])}   <- continues exactly after 16")
