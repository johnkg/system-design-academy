# Composite in Python. Files and folders share get_size() and print_tree().
from abc import ABC, abstractmethod


class Item(ABC):  # Component
    @abstractmethod
    def get_size(self) -> int: ...

    @abstractmethod
    def print_tree(self, indent: str = "") -> None: ...


class File(Item):  # Leaf
    def __init__(self, name, size):
        self.name = name
        self.size = size

    def get_size(self):
        return self.size

    def print_tree(self, indent=""):
        print(f"{indent}{self.name} ({self.size})")


class Folder(Item):  # Composite
    def __init__(self, name):
        self.name = name
        self._children = []

    def add(self, item):
        self._children.append(item)
        return self

    def get_size(self):
        return sum(c.get_size() for c in self._children)  # recurses

    def print_tree(self, indent=""):
        print(f"{indent}{self.name}/ ({self.get_size()})")
        for c in self._children:
            c.print_tree(indent + "  ")


project = (
    Folder("project")
    .add(File("readme.md", 10))
    .add(Folder("src")
         .add(File("app.js", 40))
         .add(File("util.js", 15)))
)

project.print_tree()
print(project.get_size())  # 65: the client never checks file vs folder
