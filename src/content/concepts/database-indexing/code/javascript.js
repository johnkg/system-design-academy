// Indexing in JavaScript: a full scan versus a sorted index with binary search.

const rows = Array.from({ length: 500_000 }, (_, i) => ({ id: i, email: `user${i}@example.com` }));

function fullScan(email) { // no index: read rows one by one
  let comparisons = 0;
  for (const row of rows) {
    comparisons++;
    if (row.email === email) return { row, comparisons };
  }
  return { row: null, comparisons };
}

class SortedIndex { // the idea behind a B-tree index: sorted keys with pointers to rows
  constructor(table, column) {
    this.entries = table.map((row, position) => ({ key: row[column], position }));
    this.entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  find(key) { // binary search: each step discards half of the remaining entries
    let lo = 0, hi = this.entries.length - 1, comparisons = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      comparisons++;
      const entry = this.entries[mid];
      if (entry.key === key) return { position: entry.position, comparisons };
      if (entry.key < key) lo = mid + 1; else hi = mid - 1;
    }
    return { position: -1, comparisons };
  }
}

const target = "user499999@example.com";
console.log("full scan comparisons:", fullScan(target).comparisons);

const emailIndex = new SortedIndex(rows, "email"); // built once; kept up to date on every write
const hit = emailIndex.find(target);
console.log("index comparisons:", hit.comparisons, "-> row", rows[hit.position].id);
