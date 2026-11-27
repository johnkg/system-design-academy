# Anti-Corruption Layer in Python. Billing only ever sees clean Customers, never the CRM's records.
from __future__ import annotations

from dataclasses import dataclass

LEGACY_RECORDS = {  # what the old CRM returns
    1: {"CUST_NM": "LOVELACE, ADA", "STAT_CD": "A", "BAL_AMT": "000012050"},
    2: {"CUST_NM": "HOPPER, GRACE", "STAT_CD": "X", "BAL_AMT": "000000000"},
    3: {"CUST_NM": "BABBAGE, CHARLES", "STAT_CD": "Q", "BAL_AMT": "000000500"},
}


class LegacyCrm:
    def fetch(self, record_id: int) -> dict[str, str]:
        return LEGACY_RECORDS[record_id]


@dataclass
class Customer:  # billing's own model: clean names, status and cents
    name: str
    status: str
    balance_cents: int


def capitalise(word: str) -> str:
    return word[0] + word[1:].lower()


class CustomerGateway:  # Anti-corruption layer: the only code that knows the CRM's model
    STATUSES = {"A": "active", "I": "closed", "X": "closed"}

    def __init__(self, crm: LegacyCrm) -> None:
        self.crm = crm

    def find(self, record_id: int) -> Customer:
        record = self.crm.fetch(record_id)
        last, first = record["CUST_NM"].split(", ")
        status = self.STATUSES.get(record["STAT_CD"])
        if status is None:
            raise ValueError(f"unknown status code {record['STAT_CD']}")
        return Customer(f"{capitalise(first)} {capitalise(last)}", status, int(record["BAL_AMT"]))


def cents(value: int) -> str:
    return f"{value // 100}.{value % 100:02d}"


class BillingService:  # new system: uses only its own words
    def __init__(self, customers: CustomerGateway) -> None:
        self.customers = customers

    def describe(self, record_id: int) -> None:
        try:
            c = self.customers.find(record_id)
            print(f"{c.name}, {c.status}, balance {cents(c.balance_cents)}")
        except ValueError as error:
            print(f"Rejected legacy record: {error}")


billing = BillingService(CustomerGateway(LegacyCrm()))
for record_id in (1, 2, 3):
    billing.describe(record_id)
