# Without the pattern: one class for every remote x device combination.


class TvBasicRemote:
    def __init__(self):
        self.on = False
        self.volume = 30

    def toggle_power(self):
        self.on = not self.on

    def volume_up(self):
        self.volume += 10


class TvAdvancedRemote(TvBasicRemote):
    def mute(self):
        self.volume = 0


class RadioBasicRemote:  # same logic, copied for the radio
    def __init__(self):
        self.on = False
        self.volume = 10

    def toggle_power(self):
        self.on = not self.on

    def volume_up(self):
        self.volume += 10


class RadioAdvancedRemote(RadioBasicRemote):
    def mute(self):
        self.volume = 0


# Add a Speaker device: SpeakerBasicRemote and SpeakerAdvancedRemote.
# Add a VoiceRemote type: TvVoiceRemote, RadioVoiceRemote, SpeakerVoiceRemote...

remote = TvAdvancedRemote()
remote.toggle_power()
remote.mute()
print(f"{type(remote).__name__} {{ on: {str(remote.on).lower()}, volume: {remote.volume} }}")
