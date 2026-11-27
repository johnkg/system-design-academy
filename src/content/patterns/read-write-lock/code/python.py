# Read-Write Lock in Python. The standard library has no read-write lock, so this models the lock's rules
# with try-style calls; real code would block instead of returning False.


# Illustration only: this class is NOT thread-safe. It models the rules; do not use it as a lock.
class ReadWriteLock:
    def __init__(self) -> None:
        self.readers = 0
        self._writer = False

    def try_read(self) -> bool:  # many readers may enter together, unless a writer is inside
        if self._writer:
            return False
        self.readers += 1
        return True

    def release_read(self) -> None:
        self.readers -= 1

    def try_write(self) -> bool:  # a writer needs the lock to itself
        if self._writer or self.readers > 0:
            return False
        self._writer = True
        return True

    def release_write(self) -> None:
        self._writer = False


lock = ReadWriteLock()
config = {"version": 1}  # Shared data


def read(name: str) -> None:
    if not lock.try_read():
        print(f"{name} must wait (writer active)")
        return
    print(f"{name} acquired (readers: {lock.readers}), sees version {config['version']}")


def release(name: str) -> None:
    lock.release_read()
    print(f"{name} released (readers: {lock.readers})")


read("reader 1")
read("reader 2")
if not lock.try_write():
    print(f"writer must wait (readers: {lock.readers})")
release("reader 1")
release("reader 2")
if lock.try_write():
    config["version"] = 2
    print("writer acquired (exclusive), set version 2")
read("reader 3")
lock.release_write()
print("writer released")
read("reader 3")
