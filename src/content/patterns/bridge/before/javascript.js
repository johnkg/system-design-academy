// Without the pattern: one class for every remote x device combination.
const TV_START_VOLUME = 30, RADIO_START_VOLUME = 10;
const VOLUME_STEP = 10;

class TvBasicRemote {
  constructor() { this.on = false; this.volume = TV_START_VOLUME; }
  togglePower() { this.on = !this.on; }
  volumeUp() { this.volume += VOLUME_STEP; }
}
class TvAdvancedRemote extends TvBasicRemote {
  mute() { this.volume = 0; }
}
class RadioBasicRemote {          // same logic, copied for the radio
  constructor() { this.on = false; this.volume = RADIO_START_VOLUME; }
  togglePower() { this.on = !this.on; }
  volumeUp() { this.volume += VOLUME_STEP; }
}
class RadioAdvancedRemote extends RadioBasicRemote {
  mute() { this.volume = 0; }
}
// Add a Speaker device: SpeakerBasicRemote and SpeakerAdvancedRemote.
// Add a VoiceRemote type: TvVoiceRemote, RadioVoiceRemote, SpeakerVoiceRemote...

const remote = new TvAdvancedRemote();
remote.togglePower();
remote.mute();
console.log(remote);
