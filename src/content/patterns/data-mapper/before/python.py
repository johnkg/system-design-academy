# Without the pattern: the User reads and writes rows, so it knows the column names.

class User:
    def __init__(self, row):
        self.name = row["full_name"]  # column names baked into the domain class
        self.email = row["mail"]

    def to_row(self):
        return {"full_name": self.name, "mail": self.email}


row = {"full_name": "Ada Lovelace", "mail": "ada@example.com"}
user = User(row)
print(f"Loaded: {user.name} <{user.email}>")

# The schema changes: mail becomes email_address. The User and every class like it must be edited.
renamed = {"full_name": "Ada Lovelace", "email_address": "ada@example.com"}
try:
    User(renamed)
except KeyError as missing:
    print(f"Broken after the column rename: User still reads column {missing}")
