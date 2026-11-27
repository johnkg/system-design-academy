# Claim Check in Python. The queue carries a small ticket; the heavy payload goes to storage.
from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass
class Video:
    name: str
    size_kb: int


class BlobStore:  # Payload store
    def __init__(self) -> None:
        self._blobs: dict[str, Video] = {}
        self._next = 1

    def put(self, payload: Video) -> str:
        blob_id = f"blob-{self._next}"
        self._next += 1
        self._blobs[blob_id] = payload
        return blob_id

    def get(self, blob_id: str) -> Video:
        return self._blobs[blob_id]

    def delete(self, blob_id: str) -> None:
        del self._blobs[blob_id]

    @property
    def count(self) -> int:
        return len(self._blobs)


store = BlobStore()
queue: deque[dict[str, str]] = deque()


def produce(video: Video) -> None:  # Producer: store the payload, send only the ticket
    ticket = store.put(video)
    queue.append({"ticket": ticket})
    print(f"Producer stored {video.size_kb} KB as {ticket}")
    print(f"Queue message carries ticket {ticket} only")


def consume() -> None:  # Consumer: claim the payload with the ticket
    ticket = queue.popleft()["ticket"]
    video = store.get(ticket)
    print(f"Consumer fetched {ticket} ({video.size_kb} KB) and processed {video.name}")
    store.delete(ticket)  # only after success
    print(f"Consumer deleted {ticket}")


produce(Video("holiday.mp4", 20000))
consume()
print(f"Blobs left in the store: {store.count}")
