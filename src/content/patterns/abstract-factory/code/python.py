# Abstract Factory in Python. One factory per theme, each builds a matching family.
from abc import ABC, abstractmethod


class Widget(ABC):  # Abstract Product
    @abstractmethod
    def render(self, label: str) -> str: ...


class LightButton(Widget):  # Concrete Product
    def render(self, label):
        return f"Light[ {label} ]"


class LightCheckbox(Widget):  # Concrete Product
    def render(self, label):
        return f"Light[x] {label}"


class DarkButton(Widget):  # Concrete Product
    def render(self, label):
        return f"Dark< {label} >"


class DarkCheckbox(Widget):  # Concrete Product
    def render(self, label):
        return f"Dark<x> {label}"


class WidgetFactory(ABC):  # Abstract Factory
    @abstractmethod
    def create_button(self) -> Widget: ...

    @abstractmethod
    def create_checkbox(self) -> Widget: ...


class LightFactory(WidgetFactory):  # Concrete Factory
    def create_button(self):
        return LightButton()

    def create_checkbox(self):
        return LightCheckbox()


class DarkFactory(WidgetFactory):  # Concrete Factory
    def create_button(self):
        return DarkButton()

    def create_checkbox(self):
        return DarkCheckbox()


def render_form(factory: WidgetFactory) -> str:  # Client: only knows the factory and product interfaces
    button = factory.create_button()
    checkbox = factory.create_checkbox()
    return "\n".join([checkbox.render("Remember me"), button.render("Sign in")])


print(render_form(LightFactory()))
print(render_form(DarkFactory()))  # same code, a whole different family
