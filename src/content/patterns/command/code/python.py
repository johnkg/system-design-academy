# Command in Python. Actions become objects with execute() and undo().
from abc import ABC, abstractmethod


class Document:  # Receiver
    def __init__(self):
        self.text = ""


class Command(ABC):
    @abstractmethod
    def execute(self) -> None: ...

    @abstractmethod
    def undo(self) -> None: ...


class InsertCommand(Command):  # Concrete Command
    def __init__(self, doc, text):
        self.doc = doc
        self.text = text

    def execute(self):
        self.doc.text += self.text

    def undo(self):
        self.doc.text = self.doc.text[:-len(self.text)]


class UppercaseCommand(Command):  # Concrete Command
    def __init__(self, doc):
        self.doc = doc
        self.before = ""

    def execute(self):
        self.before = self.doc.text
        self.doc.text = self.doc.text.upper()

    def undo(self):
        self.doc.text = self.before  # remember state so we can restore it


class History:  # Invoker
    def __init__(self):
        self._done = []
        self._undone = []

    def run(self, command):
        command.execute()
        self._done.append(command)
        self._undone = []  # a new action clears the redo stack

    def undo(self):
        if self._done:
            c = self._done.pop()
            c.undo()
            self._undone.append(c)

    def redo(self):
        if self._undone:
            c = self._undone.pop()
            c.execute()
            self._done.append(c)


doc = Document()
history = History()

history.run(InsertCommand(doc, "Hello"))
history.run(InsertCommand(doc, " world"))
history.run(UppercaseCommand(doc))
print(doc.text)  # HELLO WORLD
history.undo()
print(doc.text)  # Hello world
history.undo()
print(doc.text)  # Hello
history.redo()
print(doc.text)  # Hello world
