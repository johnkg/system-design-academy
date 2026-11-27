# Without the pattern: billing reads the CRM's records directly, so the CRM's model spreads through it.

LEGACY_RECORDS = {
    1: {"CUST_NM": "LOVELACE, ADA", "STAT_CD": "A", "BAL_AMT": "000012050"},
    2: {"CUST_NM": "HOPPER, GRACE", "STAT_CD": "X", "BAL_AMT": "000000000"},
    3: {"CUST_NM": "BABBAGE, CHARLES", "STAT_CD": "Q", "BAL_AMT": "000000500"},
}


def cents(value):
    return f"{value // 100}.{value % 100:02d}"


def describe(record_id):  # billing code knows column names, code letters and formats
    rec = LEGACY_RECORDS[record_id]
    last, first = rec["CUST_NM"].split(", ")
    name = f"{first[0]}{first[1:].lower()} {last[0]}{last[1:].lower()}"
    status = "active" if rec["STAT_CD"] == "A" else "closed"  # "Q" is quietly treated as closed
    print(f"{name}, {status}, balance {cents(int(rec['BAL_AMT']))}")


for record_id in (1, 2, 3):
    describe(record_id)
# Every other billing function repeats these rules, and the unknown code "Q" is never noticed.
