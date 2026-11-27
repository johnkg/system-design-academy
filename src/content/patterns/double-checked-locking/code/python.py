# Double-checked locking in Python. Check without the lock, then lock, check again and create.
import threading
import time

created = 0


class ExpensiveService:  # Instance: slow to build
    def __init__(self) -> None:
        global created
        time.sleep(0.05)
        created += 1


_instance = None  # Instance field
_lock = threading.Lock()


def get_instance() -> ExpensiveService:
    global _instance
    if _instance is None:  # first check, no lock: the fast path once the object exists
        with _lock:
            if _instance is None:  # second check: another thread may have built it while we waited
                _instance = ExpensiveService()
    return _instance


results: list[ExpensiveService] = []
threads = [threading.Thread(target=lambda: results.append(get_instance())) for _ in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"{len(threads)} callers asked for the instance")
print(f"Instances created: {created}")
print(f"All callers got the same instance: {str(all(r is results[0] for r in results)).lower()}")
