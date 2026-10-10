// Without the pattern: one class for every remote x device combination.

class TvBasicRemote {
  constructor() { this.on = false; this.volume = 30; }
  togglePower() { this.on = !this.on; }
  volumeUp() { this.volume += 10; }
}
class TvAdvancedRemote extends TvBasicRemote {
  mute() { this.volume = 0; }
}
class RadioBasicRemote {          // same logic, copied for the radio
  constructor() { this.on = false; this.volume = 10; }
  togglePower() { this.on = !this.on; }
  volumeUp() { this.volume += 10; }
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
