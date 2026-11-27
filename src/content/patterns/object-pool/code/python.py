# Object Pool in Python. Connections are created on demand up to a limit, then reused.
from __future__ import annotations


class Connection:  # Pooled object
    def __init__(self, conn_id: int) -> None:
        self.id = conn_id

    def reset(self) -> None:
        """Clear session state so the next borrower starts clean."""


class Pool:
    def __init__(self, size: int) -> None:
        self.size = size
        self.created = 0
        self._free: list[Connection] = []

    def acquire(self) -> tuple[Connection, str] | None:  # None when every connection is busy
        if self._free:
            return self._free.pop(), "reused"
        if self.created >= self.size:
            return None
        self.created += 1
        return Connection(self.created), "created"

    def release(self, conn: Connection) -> None:
        conn.reset()
        self._free.append(conn)


pool = Pool(3)
held: dict[int, Connection] = {}

for request in [1, 2, 3, 4]:
    got = pool.acquire()
    if got is None:
        print(f"request {request} must wait: all {pool.size} connections busy")
        continue
    conn, how = got
    held[request] = conn
    print(f"request {request} uses connection {conn.id} ({how})")

pool.release(held[1])
print(f"request 1 done, connection {held[1].id} returned (reset)")

conn, how = pool.acquire()
print(f"request 4 uses connection {conn.id} ({how})")
print(f"Connections created: {pool.created}")
