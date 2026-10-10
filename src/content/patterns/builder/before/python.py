# Without the pattern: a long positional constructor.


class Pizza:
    def __init__(self, size, crust, has_cheese, toppings, extra_sauce, gluten_free):
        self.size = size
        self.crust = crust
        self.has_cheese = has_cheese
        self.toppings = toppings
        self.extra_sauce = extra_sauce
        self.gluten_free = gluten_free


def show(pizza):  # formats the object like the JavaScript console.log does
    toppings = ", ".join(f"'{t}'" for t in pizza.toppings)
    return (
        "Pizza {\n"
        f"  size: '{pizza.size}',\n"
        f"  crust: '{pizza.crust}',\n"
        f"  hasCheese: {str(pizza.has_cheese).lower()},\n"
        f"  toppings: [ {toppings} ],\n"
        f"  extraSauce: {str(pizza.extra_sauce).lower()},\n"
        f"  glutenFree: {str(pizza.gluten_free).lower()}\n"
        "}"
    )


# What do these mean? Which boolean is which? Callers must pass everything.
a = Pizza("large", "thick", True, ["ham", "olives"], True, False)
b = Pizza("medium", "thin", True, ["mozzarella", "basil"], False, False)
print(show(a), show(b))
# Adding "stuffed_crust" later means a seventh argument at every call site.
