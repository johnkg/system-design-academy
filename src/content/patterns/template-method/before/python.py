# Without the pattern: each drink copies the whole recipe.

class Tea:
    def prepare(self):
        print("Boiling water")
        print("Steeping the tea bag")
        print("Pouring into cup")
        print("Adding lemon")


class Coffee:
    def prepare(self):
        print("Boiling water")  # copied
        print("Dripping coffee through the filter")
        print("Pouring into cup")  # copied
        # someone forgot the condiments step here, and nothing complains


Tea().prepare()
print("---")
Coffee().prepare()
# Change the shared "boil water" step? Edit every class. The order can drift silently.
