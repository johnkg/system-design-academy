# Singleton in Python. Python has no private constructors, so a flag guards `AppConfig()`.
from __future__ import annotations


class AppConfig:  # Singleton
    _instance: AppConfig | None = None
    _creating = False

    def __init__(self):
        if not AppConfig._creating:
            raise RuntimeError("Use AppConfig.getInstance()")
        self._settings: dict[str, object] = {}

    @staticmethod
    def get_instance() -> AppConfig:
        if AppConfig._instance is None:  # created once, on first use
            AppConfig._creating = True
            AppConfig._instance = AppConfig()
            AppConfig._creating = False
        return AppConfig._instance

    def set(self, key: str, value: object) -> None:
        self._settings[key] = value

    def get(self, key: str) -> object | None:
        return self._settings.get(key)


header = AppConfig.get_instance()  # Client
header.set("theme", "dark")

footer = AppConfig.get_instance()  # Client
print(footer.get("theme"))         # "dark": same object
print(str(header is footer).lower())  # true

try:
    AppConfig()                    # duplicates are refused
except RuntimeError as error:
    print(error)
