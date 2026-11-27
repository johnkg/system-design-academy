# Without the pattern: every request opens its own connection.

opened = 0


def open_connection():  # slow, and the database allows only a few at once
    global opened
    opened += 1
    return {"id": opened}


for request in [1, 2, 3, 4]:
    conn = open_connection()
    print(f"request {request} opens a new connection {conn['id']}")
print(f"Connections created: {opened}")  # one per request: no reuse, no upper limit
