# Iterator in Python. Hand-written for teaching; Python also has built-in iterators and generators.
from __future__ import annotations

from abc import ABC, abstractmethod


class SongIterator(ABC):  # Iterator
    @abstractmethod
    def has_next(self) -> bool: ...

    @abstractmethod
    def next(self) -> str: ...


class ForwardIterator(SongIterator):  # Concrete Iterator
    def __init__(self, songs: list[str]):
        self._songs = songs
        self._index = 0

    def has_next(self) -> bool:
        return self._index < len(self._songs)

    def next(self) -> str:
        song = self._songs[self._index]
        self._index += 1
        return song


class ReverseIterator(SongIterator):  # Concrete Iterator
    def __init__(self, songs: list[str]):
        self._songs = songs
        self._index = len(songs) - 1

    def has_next(self) -> bool:
        return self._index >= 0

    def next(self) -> str:
        song = self._songs[self._index]
        self._index -= 1
        return song


class Playlist:  # Aggregate: hides how songs are stored
    def __init__(self):
        self._songs: list[str] = []

    def add(self, song: str) -> Playlist:
        self._songs.append(song)
        return self

    def create_iterator(self) -> SongIterator:
        return ForwardIterator(self._songs)

    def create_reverse_iterator(self) -> SongIterator:
        return ReverseIterator(self._songs)


playlist = Playlist().add("Intro").add("Verse").add("Chorus")

forward = playlist.create_iterator()  # Client
while forward.has_next():
    print(forward.next())  # Intro, Verse, Chorus

reverse = playlist.create_reverse_iterator()
other = playlist.create_iterator()  # independent position
print(reverse.next(), other.next())  # Chorus Intro
