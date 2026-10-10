# Without the pattern: the form picks every widget's class itself.


class LightButton:
    def render(self, label):
        return f"Light[ {label} ]"


class LightCheckbox:
    def render(self, label):
        return f"Light[x] {label}"


class DarkButton:
    def render(self, label):
        return f"Dark< {label} >"


class DarkCheckbox:
    def render(self, label):
        return f"Dark<x> {label}"


def render_form(theme):
    button = DarkButton() if theme == "dark" else LightButton()
    checkbox = DarkCheckbox() if theme == "dark" else LightCheckbox()
    # Every widget repeats the theme check. A third theme means editing this
    # function and every other place that builds widgets. Easy to mix families by mistake:
    # checkbox = LightCheckbox()   # oops, light checkbox in a dark form
    return "\n".join([checkbox.render("Remember me"), button.render("Sign in")])


print(render_form("light"))
print(render_form("dark"))
