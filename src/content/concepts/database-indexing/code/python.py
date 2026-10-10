# Indexing in Python: a full scan versus a sorted index with binary search.

rows = [{"id": i, "email": f"user{i}@example.com"} for i in range(500_000)]


def full_scan(email):  # no index: read rows one by one
    comparisons = 0
    for row in rows:
        comparisons += 1
        if row["email"] == email:
            return row, comparisons
    return None, comparisons


class SortedIndex:  # the idea behind a B-tree index: sorted keys with pointers to rows
    def __init__(self, table, column):
        self.entries = [(row[column], position) for position, row in enumerate(table)]
        self.entries.sort(key=lambda e: e[0])

    def find(self, key):  # binary search: each step discards half of the remaining entries
        lo, hi, comparisons = 0, len(self.entries) - 1, 0
        while lo <= hi:
            mid = (lo + hi) // 2
            comparisons += 1
            entry_key, position = self.entries[mid]
            if entry_key == key:
                return position, comparisons
            if entry_key < key:
                lo = mid + 1
            else:
                hi = mid - 1
        return -1, comparisons


target = "user499999@example.com"
print("full scan comparisons:", full_scan(target)[1])

email_index = SortedIndex(rows, "email")  # built once; kept up to date on every write
position, comparisons = email_index.find(target)
print("index comparisons:", comparisons, "-> row", rows[position]["id"])
