# Bridge in Python. Remote (abstraction) delegates to a Device (implementation).
from abc import ABC, abstractmethod


class Device(ABC):  # Implementor
    def __init__(self, volume):
        self._on = False
        self._volume = volume

    def is_enabled(self):
        return self._on

    def enable(self):
        self._on = True

    def disable(self):
        self._on = False

    def get_volume(self):
        return self._volume

    def set_volume(self, v):
        self._volume = max(0, min(100, v))

    @abstractmethod
    def name(self) -> str: ...


class Tv(Device):  # Concrete Implementor
    def __init__(self):
        super().__init__(volume=30)

    def name(self):
        return "TV"


class Radio(Device):  # Concrete Implementor
    def __init__(self):
        super().__init__(volume=10)

    def name(self):
        return "Radio"


class Remote:  # Abstraction: holds the bridge
    def __init__(self, device):
        self.device = device

    def toggle_power(self):
        if self.device.is_enabled():
            self.device.disable()
        else:
            self.device.enable()

    def volume_up(self):
        self.device.set_volume(self.device.get_volume() + 10)


class AdvancedRemote(Remote):  # Refined Abstraction
    def mute(self):
        self.device.set_volume(0)


for device in [Tv(), Radio()]:
    remote = AdvancedRemote(device)  # any remote works with any device
    remote.toggle_power()
    remote.volume_up()
    print(f"{device.name()}: on={str(device.is_enabled()).lower()} volume={device.get_volume()}")
    remote.mute()
    print(f"{device.name()}: volume={device.get_volume()}")
