# Without the pattern: every component makes its own AppConfig.

class AppConfig:
    def __init__(self):
        self._settings = {}

    def set(self, key, value):
        self._settings[key] = value

    def get(self, key):
        return self._settings.get(key)


header = AppConfig()
header.set("theme", "dark")

footer = AppConfig()  # a second, separate object
print("undefined" if footer.get("theme") is None else footer.get("theme"))  # undefined: the footer never saw the change
print(str(header is footer).lower())  # false
