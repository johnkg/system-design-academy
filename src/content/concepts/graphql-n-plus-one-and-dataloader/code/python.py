# A miniature GraphQL-style executor over in-memory tables, with a DataLoader that collects keys until the end of a tick.
# The "tick" is simulated: the executor calls dispatch() after every resolver of one tree level has run, so it is deterministic.
import sys

N, M, USERS = 5, 4, 6  # 5 posts, 4 comments each, 6 users
users = [{"tag": f"U{i}", "id": i} for i in range(1, USERS + 1)]
posts = [{"tag": f"P{i}", "id": i, "authorId": ((i * 2) % USERS) + 1} for i in range(1, N + 1)]
comments = [{"tag": f"C{i}", "id": i, "postId": (i - 1) // M + 1, "authorId": ((i * 5 + 3) % USERS) + 1} for i in range(1, N * M + 1)]


class Db:  # counts every query it receives
    def __init__(self):
        self.queries = self.keys = self.rows = 0
        self.log = []

    def run(self, sql, keys, rows):
        self.queries += 1
        self.keys += keys
        self.rows += len(rows)
        self.log.append(sql)
        return rows

    def all_posts(self):
        return self.run("SELECT * FROM posts", 0, posts)

    def users_in(self, ids):
        s = set(ids)
        return self.run(f"SELECT * FROM users WHERE id IN ({','.join(map(str, dict.fromkeys(ids)))})", len(ids), [u for u in users if u["id"] in s])

    def comments_in(self, ids):
        s = set(ids)
        return self.run(f"SELECT * FROM comments WHERE post_id IN ({','.join(map(str, dict.fromkeys(ids)))})", len(ids), [c for c in comments if c["postId"] in s])


class Future:
    value = None


class Loader:
    def __init__(self, batch_fn, batch, cache):
        self.batch_fn, self.batch, self.cache = batch_fn, batch, cache
        self.queue, self.memo, self.hits = [], {}, 0

    def load(self, key):
        if self.cache and key in self.memo:  # per-request cache
            self.hits += 1
            return self.memo[key]
        f = Future()
        if self.cache:
            self.memo[key] = f
        self.queue.append((key, f))
        if not self.batch:
            self.dispatch()  # not batching: one query per load
        return f

    def dispatch(self):  # end of tick: one batch function call for every queued key
        if not self.queue:
            return
        q, self.queue = self.queue, []
        found = self.batch_fn([k for k, _ in q])  # dict key -> value
        for k, f in q:
            f.value = found.get(k)


resolvers = {  # field name -> (parent row, ctx) => value or Future
    "posts": lambda _, ctx: ctx["db"].all_posts(),
    "comments": lambda post, ctx: ctx["comments"].load(post["id"]),
    "author": lambda row, ctx: ctx["users"].load(row["authorId"]),
}


def execute(selection, parents, ctx):  # resolves one tree level at a time
    pending = [[resolvers[s[0]](p["row"], ctx) for p in parents] for s in selection]  # every resolver of this level runs first
    ctx["users"].dispatch()
    ctx["comments"].dispatch()  # ...then the tick ends and the loaders fire
    for si, (name, kids_sel) in enumerate(selection):
        kids = []
        for i, p in enumerate(parents):
            v = pending[si][i]
            v = v.value if isinstance(v, Future) else v
            nodes = [{"row": row, "out": []} for row in (v if isinstance(v, list) else [v])]
            p["out"].append((name, nodes, isinstance(v, list)))
            kids.extend(nodes)
        execute(kids_sel, kids, ctx)


def ser(n):
    parts = ";".join(f"{name}:{'[' if is_list else ''}{','.join(ser(k) for k in kids)}{']' if is_list else ''}" for name, kids, is_list in n["out"])
    return f"{n['row']['tag'] if n['row'] else ''}{{{parts}}}"


def fnv(s):
    h = 0x811C9DC5
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h


def run(selection, mode):
    batch, cache = {"naive": (False, False), "batch": (True, False), "cache": (True, True)}[mode]
    db = Db()

    def comments_batch(ids):
        rows = db.comments_in(ids)
        return {i: [c for c in rows if c["postId"] == i] for i in ids}

    ctx = {"db": db, "users": Loader(lambda ids: {r["id"]: r for r in db.users_in(ids)}, batch, cache), "comments": Loader(comments_batch, batch, cache)}
    root = {"row": None, "out": []}
    execute(selection, [root], ctx)
    hits = ctx["users"].hits + ctx["comments"].hits
    s = fnv(ser(root))
    print(f"  {mode.ljust(5)} queries={db.queries:>2} keys={db.keys:>2} rows={db.rows:>2} cache_hits={hits:>2} checksum={s}")
    return db, s


def check(ok, msg):
    if not ok:
        print("FAILED: " + msg)
        sys.exit(1)


def sel(name, *kids):
    return (name, list(kids))


queries = [
    ("posts { comments { author } }", [sel("posts", sel("comments", sel("author")))], 1 + N + N * M, 3),
    ("posts { author comments { author } }", [sel("posts", sel("author"), sel("comments", sel("author")))], 1 + N + N + N * M, 4),
]
for text, selection, naive_q, batch_q in queries:
    print(text)
    (da, sa), (db_, sb), (dc, sc) = run(selection, "naive"), run(selection, "batch"), run(selection, "cache")
    check(sa == sb == sc, "all strategies must return identical results")
    check(da.queries == naive_q, f"naive must make {naive_q} queries")
    check(db_.queries == batch_q and dc.queries == batch_q, f"batched must make {batch_q} queries")
    check(dc.keys < db_.keys, "the cache must send fewer keys")
    if text.startswith("posts { comments"):
        for sql in dc.log:
            print("    " + sql)
print("identical results, exact query counts")
