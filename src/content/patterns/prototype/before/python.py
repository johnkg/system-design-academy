# Without the pattern: a shallow copy shares the nested list.
import copy


class Enemy:
    def __init__(self, name, hp, items=None):
        self.name = name
        self.hp = hp
        self.items = items if items is not None else []


def js_list(items):  # format like Node's console.log of an array
    return "[ " + ", ".join(f"'{i}'" for i in items) + " ]"


template = Enemy("Goblin", 30, ["club"])
a = copy.copy(template)  # looks like a copy, but items is the same list
b = copy.copy(template)

a.items.append("shield")
print(js_list(a.items))  # [ 'club', 'shield' ]
print(js_list(b.items))  # [ 'club', 'shield' ]  <- leaked into b (and into template)
print(str(template.items is a.items).lower())  # true
