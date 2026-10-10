# State in Python. Each state class decides what each action does.
from __future__ import annotations

from abc import ABC, abstractmethod


class State(ABC):
    @abstractmethod
    def edit(self, doc: Document) -> str: ...

    @abstractmethod
    def publish(self, doc: Document) -> str: ...

    @abstractmethod
    def reject(self, doc: Document) -> str: ...


class Draft(State):  # Concrete State
    def edit(self, doc):
        return "Editing the draft"

    def publish(self, doc):
        doc.set_state(Review())
        return "Sent to review"

    def reject(self, doc):
        return "A draft has nothing to reject"


class Review(State):  # Concrete State
    def edit(self, doc):
        return "Cannot edit while in review"

    def publish(self, doc):
        doc.set_state(Published())
        return "Approved and published"

    def reject(self, doc):
        doc.set_state(Draft())
        return "Sent back to draft"


class Published(State):  # Concrete State
    def edit(self, doc):
        return "Cannot edit a published document"

    def publish(self, doc):
        return "Already published"

    def reject(self, doc):
        doc.set_state(Draft())
        return "Unpublished: back to draft"


class Document:  # Context: delegates everything to the current state
    def __init__(self):
        self._state: State = Draft()

    def set_state(self, state: State) -> None:
        self._state = state

    @property
    def state_name(self) -> str:
        return type(self._state).__name__

    def edit(self) -> str:
        return self._state.edit(self)

    def publish(self) -> str:
        return self._state.publish(self)

    def reject(self) -> str:
        return self._state.reject(self)


doc = Document()
print(doc.state_name, "->", doc.edit())      # Draft -> Editing the draft
print(doc.publish(), "|", doc.state_name)    # Sent to review | Review
print(doc.edit())                            # Cannot edit while in review
print(doc.publish(), "|", doc.state_name)    # Approved and published | Published
print(doc.reject(), "|", doc.state_name)     # Unpublished: back to draft | Draft
