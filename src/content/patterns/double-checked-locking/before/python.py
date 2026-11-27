# Without the pattern: check, then create, with no lock. Every thread that arrives early builds its own.
import threading
import time

created = 0
_instance = None


class ExpensiveService:
    def __init__(self):
        global created
        time.sleep(0.05)
        created += 1


def get_instance():
    global _instance
    if _instance is None:  # several threads see None before the first one has finished
        _instance = ExpensiveService()
    return _instance


threads = [threading.Thread(target=get_instance) for _ in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(f"Instances created: {created}")  # about 8, not 1
