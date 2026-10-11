# A tiny column store with date partitions and zone maps, in Python:
# rows are cut into partitions by day, each column is encoded on its own, and a query reads only the columns and partitions it needs.
import sys

ROWS, DAYS, PART_DAYS, ROW_BYTES = 6000, 30, 5, 14  # a row store keeps day 4 + country 2 + qty 4 + amount 4 bytes together
COUNTRIES = ['BR', 'DE', 'IN', 'JP', 'US']
COLUMNS = ['day', 'country', 'qty', 'amount']
RAW_WIDTH = {'day': 4, 'country': 2, 'qty': 4, 'amount': 4}

seed = 7


def next_int(n):
    global seed
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return (seed // 65536) % n


def bytes_for(biggest):
    """The narrowest whole number of bytes that holds the biggest value."""
    return 1 if biggest < 256 else 2 if biggest < 65536 else 4


rows = []
for i in range(ROWS):
    country = next_int(5)
    qty = 1 + next_int(5)
    amount = 1 + next_int(500)
    rows.append({'day': i * DAYS // ROWS, 'country': country, 'qty': qty, 'amount': amount})  # rows arrive in date order

# Cut into partitions by day. Inside a partition sort by country (the sort key), so equal countries sit in long runs.
parts = []
for p in range(DAYS // PART_DAYS):
    items = sorted((r for r in rows if r['day'] // PART_DAYS == p), key=lambda r: r['country'])
    n = len(items)
    days = [r['day'] for r in items]
    min_day, max_day = min(days), max(days)  # the zone map of this partition
    runs = sum(1 for i, r in enumerate(items) if i == 0 or r['country'] != items[i - 1]['country'])
    size = {
        'day': bytes_for(max_day - min_day) * n,                      # delta from the partition's first day
        'country': runs * 3,                                          # run-length: 1 byte code + 2 bytes count per run
        'qty': bytes_for(max(r['qty'] for r in items)) * n,           # bit-packed to the width the values need
        'amount': bytes_for(max(r['amount'] for r in items)) * n,
    }
    parts.append({'min_day': min_day, 'max_day': max_day, 'n': n, 'items': items, 'size': size})


def scan(want, lo, hi, prune):
    """Read the wanted columns of the partitions that can hold days lo..hi. Returns bytes read and the matching rows."""
    total, scanned, rows_read, hit = 0, 0, 0, []
    for p in parts:
        if prune and (p['max_day'] < lo or p['min_day'] > hi):
            continue  # the zone map proves nothing here can match
        inside = p['min_day'] >= lo and p['max_day'] <= hi  # every row matches, so the day column is not needed
        need = want if prune and inside else list(dict.fromkeys(want + ['day']))
        total += sum(p['size'][c] for c in need)
        scanned += 1
        rows_read += p['n']
        hit.extend(r for r in p['items'] if lo <= r['day'] <= hi)
    return {'bytes': total, 'scanned': scanned, 'rows_read': rows_read, 'hit': hit}


def total_amount(hit):
    return sum(r['amount'] for r in hit)


print(f'{ROWS} rows in {len(parts)} partitions of {PART_DAYS} days')
for c in COLUMNS:
    enc = sum(p['size'][c] for p in parts)
    print(f'column {c}: {ROWS * RAW_WIDTH[c]} B raw -> {enc} B encoded')

LO, HI = 17, 24
in_range = [r for r in rows if LO <= r['day'] <= HI]
queries = [
    ('sum(amount)', ['amount'], lambda hit: str(total_amount(hit))),
    ('sum(amount) by country', ['country', 'amount'],
     lambda hit: ' '.join(f'{c}={total_amount([r for r in hit if r["country"] == i])}' for i, c in enumerate(COUNTRIES))),
    ('select *', COLUMNS, lambda hit: f'{len(hit)} rows, amount total {total_amount(hit)}'),
]
row_store = ROWS * ROW_BYTES
for name, want, answer in queries:
    everything, pruned = scan(want, LO, HI, False), scan(want, LO, HI, True)
    result = answer(pruned['hit'])
    print(f'{name} where day {LO}..{HI}: {result}')
    print(f"  row store {row_store} B | row store, same partitions {pruned['rows_read'] * ROW_BYTES} B | columns {everything['bytes']} B | columns + zone maps {pruned['bytes']} B ({pruned['scanned']} of {len(parts)} partitions)")
    assert result == answer(in_range) == answer(everything['hit']), 'same answer as a plain loop over the rows'
    assert pruned['bytes'] < everything['bytes'] < row_store and pruned['scanned'] == 2
sys.exit(0)
