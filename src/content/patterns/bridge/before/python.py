# Without the pattern: one class for every remote x device combination.
TV_START_VOLUME, RADIO_START_VOLUME = 30, 10
VOLUME_STEP = 10


class TvBasicRemote:
    def __init__(self):
        self.on = False
        self.volume = TV_START_VOLUME

    def toggle_power(self):
        self.on = not self.on

    def volume_up(self):
        self.volume += VOLUME_STEP


class TvAdvancedRemote(TvBasicRemote):
    def mute(self):
        self.volume = 0


class RadioBasicRemote:  # same logic, copied for the radio
    def __init__(self):
        self.on = False
        self.volume = RADIO_START_VOLUME

    def toggle_power(self):
        self.on = not self.on

    def volume_up(self):
        self.volume += VOLUME_STEP


class RadioAdvancedRemote(RadioBasicRemote):
    def mute(self):
        self.volume = 0


# Add a Speaker device: SpeakerBasicRemote and SpeakerAdvancedRemote.
# Add a VoiceRemote type: TvVoiceRemote, RadioVoiceRemote, SpeakerVoiceRemote...

remote = TvAdvancedRemote()
remote.toggle_power()
remote.mute()
print(f"{type(remote).__name__} {{ on: {str(remote.on).lower()}, volume: {remote.volume} }}")
