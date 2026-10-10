# Proxy in Python. A virtual proxy that loads the real image lazily.
from __future__ import annotations

from typing import Protocol


class Image(Protocol):
    def display(self) -> None: ...


class RealImage:  # Real Subject
    def __init__(self, file: str):
        self.file = file
        print(f"Loading {file} from disk (slow)...")

    def display(self) -> None:
        print(f"Displaying {self.file}")


class ImageProxy:  # Proxy: same interface as RealImage
    def __init__(self, file: str):
        self.file = file
        self._real: RealImage | None = None

    def display(self) -> None:
        if self._real is None:
            self._real = RealImage(self.file)  # create on first use only
        self._real.display()


class Gallery:  # Client: works with anything that has display()
    def __init__(self, images: list[Image]):
        self.images = images

    def show(self, index: int) -> None:
        self.images[index].display()


gallery = Gallery([ImageProxy(f) for f in ["a.jpg", "b.jpg", "c.jpg"]])
print("Gallery ready (nothing loaded yet)")
gallery.show(1)  # loads b.jpg
gallery.show(1)  # already loaded: displays only
