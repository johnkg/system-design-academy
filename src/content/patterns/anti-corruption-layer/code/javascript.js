// Anti-Corruption Layer in JavaScript. Billing only ever sees clean Customers, never the CRM's records.

const LEGACY_RECORDS = { // what the old CRM returns
  1: { CUST_NM: "LOVELACE, ADA", STAT_CD: "A", BAL_AMT: "000012050" },
  2: { CUST_NM: "HOPPER, GRACE", STAT_CD: "X", BAL_AMT: "000000000" },
  3: { CUST_NM: "BABBAGE, CHARLES", STAT_CD: "Q", BAL_AMT: "000000500" },
};
const legacyCrm = { fetch: (id) => LEGACY_RECORDS[id] };

class Customer { // billing's own model: clean names, status and cents
  constructor(name, status, balanceCents) { Object.assign(this, { name, status, balanceCents }); }
}

const capitalise = (word) => word.charAt(0) + word.slice(1).toLowerCase();

class CustomerGateway { // Anti-corruption layer: the only code that knows the CRM's model
  constructor(crm) { this.crm = crm; }

  find(id) {
    const record = this.crm.fetch(id);
    const [last, first] = record.CUST_NM.split(", ");
    const status = { A: "active", I: "closed", X: "closed" }[record.STAT_CD];
    if (!status) throw new Error(`unknown status code ${record.STAT_CD}`);
    return new Customer(`${capitalise(first)} ${capitalise(last)}`, status, Number(record.BAL_AMT));
  }
}

const cents = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

class BillingService { // new system: uses only its own words
  constructor(customers) { this.customers = customers; }
  describe(id) {
    try {
      const c = this.customers.find(id);
      console.log(`${c.name}, ${c.status}, balance ${cents(c.balanceCents)}`);
    } catch (error) {
      console.log(`Rejected legacy record: ${error.message}`);
    }
  }
}

const billing = new BillingService(new CustomerGateway(legacyCrm));
[1, 2, 3].forEach((id) => billing.describe(id));
