# The retrieval core of a RAG platform, in Python:
# documents are split into chunks, indexed by keyword and by a toy embedding, searched with the asker's groups,
# merged with reciprocal rank fusion, and re-synced so that changes and deletes reach the index.
import re
import sys

DIM = 16
RRF_K, RRF_SCALE = 60, 1000000  # the usual fusion constant; scores kept as whole numbers
TOP_K, WIDE_K = 3, 5


def hash_of(s):
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def tokens(text):
    return [w for w in re.split(r'[^a-z]+', text.lower()) if len(w) > 2]


embed_calls = 0  # a real embedding call costs money, so we count them


def embed(words):  # toy embedding: each word adds +1 or -1 to one of 16 dimensions
    global embed_calls
    embed_calls += 1
    v = [0] * DIM
    for w in words:
        h = hash_of(w)
        v[h % DIM] += 1 if (h >> 8) & 1 else -1
    return v


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


class Index:
    def __init__(self):
        self.chunks = {}  # chunk id -> chunk
        self.docs = {}    # doc id -> hash and chunk ids

    # Bring one document up to date. Unchanged text costs nothing; a changed ACL only rewrites metadata.
    def sync(self, doc):
        text_hash, old = hash_of(doc['text']), self.docs.get(doc['id'])
        if old and old['hash'] == text_hash:
            for cid in old['ids']:
                self.chunks[cid]['acl'] = doc['acl']
            return
        if old:
            self.remove(doc['id'])  # replace old chunks, never leave them behind
        ids = []
        for i, t in enumerate(doc['text'].split('. ')):
            cid, words = f"{doc['id']}#{i}", tokens(t)
            self.chunks[cid] = {'id': cid, 'title': doc['title'], 'acl': doc['acl'], 'words': words, 'vec': embed(words)}
            ids.append(cid)
        self.docs[doc['id']] = {'hash': text_hash, 'ids': ids}

    def remove(self, doc_id):
        for cid in self.docs[doc_id]['ids']:
            del self.chunks[cid]
        del self.docs[doc_id]

    # Delete propagation: anything the source no longer lists is removed from the index.
    def sync_all(self, source):
        for d in source:
            self.sync(d)
        live = {d['id'] for d in source}
        for doc_id in list(self.docs):
            if doc_id not in live:
                self.remove(doc_id)

    # The asker's groups are applied before ranking, so the top k is full of chunks they may read.
    def search(self, groups, query, k, enforce=True):
        q = tokens(query)
        qv = embed(q)
        allowed = [c for c in self.chunks.values() if not enforce or any(g in groups for g in c['acl'])]
        keyword = [(c, sum(c['words'].count(w) for w in q)) for c in allowed]
        vector = [(c, dot(qv, c['vec'])) for c in allowed]

        def by_score(lst):
            return [c['id'] for c, s in sorted((e for e in lst if e[1] > 0), key=lambda e: (-e[1], e[0]['id']))]

        fused = {}  # reciprocal rank fusion: a chunk near the top of either list scores well
        for ranked in (by_score(keyword), by_score(vector)):
            for r, cid in enumerate(ranked):
                fused[cid] = fused.get(cid, 0) + RRF_SCALE // (RRF_K + r + 1)
        return [cid for cid, _ in sorted(fused.items(), key=lambda e: (-e[1], e[0]))[:k]]


source = [
    {'id': 'hr1', 'title': 'Leave policy', 'acl': ['all'], 'text': 'Employees get sixteen weeks of paid parental leave. Request leave in the people portal. Managers approve leave within two days'},
    {'id': 'hr2', 'title': 'Salary bands', 'acl': ['hr'], 'text': 'Salary bands are reviewed each year. Senior engineer salary starts at band five. Bonus targets follow the salary band'},
    {'id': 'en1', 'title': 'Failover runbook', 'acl': ['eng'], 'text': 'When the primary database fails, page the on call engineer. Check replication lag before moving traffic. Approve the failover in the portal'},
    {'id': 'tr1', 'title': 'Travel policy', 'acl': ['all'], 'text': 'Book travel in the portal. Flights above five hundred dollars need manager approval'},
]
index = Index()
index.sync_all(source)


def show(ids):
    return ', '.join(f"{i} ({index.chunks[i]['title']})" for i in ids)


query = 'salary band approval in the portal'
as_engineer = index.search(['all', 'eng'], query, TOP_K)
as_hr = index.search(['all', 'hr'], query, TOP_K)
print(f"engineer asks: {show(as_engineer)}")
print(f"hr asks: {show(as_hr)}")

unfiltered = [i for i in index.search(['all', 'eng'], query, TOP_K, False) if not any(g in ['all', 'eng'] for g in index.chunks[i]['acl'])]
print(f"without the filter, the engineer's top 3 would hold {len(unfiltered)} unreadable chunk(s): {show(unfiltered)}")

calls_before = embed_calls
index.sync_all(source)
print(f"re-sync with no changes: {embed_calls - calls_before} embedding calls")
source[2] = {**source[2], 'text': 'When the primary database fails, page the on call engineer. Promote the replica with the lowest lag'}
source[1] = {**source[1], 'acl': ['hr', 'eng']}
source.pop()  # the travel policy is deleted at the source
index.sync_all(source)
sync_calls = embed_calls - calls_before
print(f"after edit, ACL change and delete: {sync_calls} embedding calls, {len(index.chunks)} chunks")
print(f"engineer asks again: {show(index.search(['all', 'eng'], query, TOP_K))}")

leaked = any(i.startswith('tr1') for i in index.chunks)
hr_seen = any(i.startswith('hr2') for i in index.search(['all', 'eng'], 'salary band', WIDE_K))
secret = any(i.startswith('hr2') for i in as_engineer)
print(f"deleted doc still indexed: {str(leaked).lower()}; hr doc hidden before the ACL change: {str(not secret).lower()}; visible after: {str(hr_seen).lower()}")
if leaked or secret or not hr_seen or sync_calls != 2 or len(unfiltered) == 0:
    sys.exit(1)
