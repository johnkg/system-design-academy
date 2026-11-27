// Without the pattern: billing reads the CRM's records directly, so the CRM's model spreads through it.

const LEGACY_RECORDS = {
  1: { CUST_NM: "LOVELACE, ADA", STAT_CD: "A", BAL_AMT: "000012050" },
  2: { CUST_NM: "HOPPER, GRACE", STAT_CD: "X", BAL_AMT: "000000000" },
  3: { CUST_NM: "BABBAGE, CHARLES", STAT_CD: "Q", BAL_AMT: "000000500" },
};

const cents = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

function describe(id) { // billing code knows column names, code letters and formats
  const rec = LEGACY_RECORDS[id];
  const [last, first] = rec.CUST_NM.split(", ");
  const name = `${first.charAt(0)}${first.slice(1).toLowerCase()} ${last.charAt(0)}${last.slice(1).toLowerCase()}`;
  const status = rec.STAT_CD === "A" ? "active" : "closed"; // "Q" is quietly treated as closed
  console.log(`${name}, ${status}, balance ${cents(Number(rec.BAL_AMT))}`);
}

[1, 2, 3].forEach(describe);
// Every other billing function repeats these rules, and the unknown code "Q" is never noticed.
