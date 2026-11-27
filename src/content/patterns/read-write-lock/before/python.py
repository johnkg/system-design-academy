# Without the pattern: one plain lock, so readers take turns even though reading changes nothing.

class Mutex:
    def __init__(self):
        self._held = False

    def try_lock(self):
        if self._held:
            return False
        self._held = True
        return True

    def unlock(self):
        self._held = False


mutex = Mutex()


def read(name):
    if not mutex.try_lock():
        print(f"{name} must wait (lock is held)")
        return
    print(f"{name} acquired")


def release(name):
    mutex.unlock()
    print(f"{name} released")


read("reader 1")
read("reader 2")  # blocked, although reader 1 only reads
release("reader 1")
read("reader 2")
release("reader 2")
