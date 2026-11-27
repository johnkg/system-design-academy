# Data Mapper in Python. The User knows nothing about the table; the mapper does.
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class User:  # Domain object
    id: int
    name: str
    email: str

    def rename(self, name: str) -> None:
        self.name = name


class Table:  # Storage: rows are plain column-to-value dicts
    def __init__(self) -> None:
        self.rows: dict[int, dict[str, str]] = {}

    def put(self, row_id: int, row: dict[str, str]) -> None:
        self.rows[row_id] = dict(row)

    def get(self, row_id: int) -> dict[str, str]:
        return dict(self.rows[row_id])

    def rename_column(self, old: str, new: str) -> None:
        for row_id, row in self.rows.items():
            self.rows[row_id] = {(new if k == old else k): v for k, v in row.items()}


class UserMapper:  # Mapper: the only class that reads or writes the columns; their names are configured where it is built
    def __init__(self, table: Table, columns: dict[str, str]) -> None:
        self.table, self.columns = table, columns

    def find(self, user_id: int) -> User:
        row = self.table.get(user_id)
        return User(user_id, row[self.columns["name"]], row[self.columns["email"]])

    def save(self, user: User) -> None:
        self.table.put(user.id, {self.columns["name"]: user.name, self.columns["email"]: user.email})


def show(row: dict[str, str]) -> str:
    return "; ".join(f"{k}={v}" for k, v in row.items())


table = Table()
table.put(1, {"full_name": "Ada Lovelace", "mail": "ada@example.com"})
mapper = UserMapper(table, {"name": "full_name", "email": "mail"})

user = mapper.find(1)
print(f"Loaded: {user.name} <{user.email}>")

user.rename("Ada King")
mapper.save(user)
print(f"Row: {show(table.get(1))}")

table.rename_column("mail", "email_address")  # the schema changes...
after_rename = UserMapper(table, {"name": "full_name", "email": "email_address"})  # ...and only this line follows
again = after_rename.find(1)
print(f"Loaded after the column rename: {again.name} <{again.email}>")
