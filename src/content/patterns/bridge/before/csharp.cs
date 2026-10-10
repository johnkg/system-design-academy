// Without the pattern: one class for every remote x device combination.
using System;

public static class Program
{
    public static void Main()
    {
        var remote = new TvAdvancedRemote();
        remote.TogglePower();
        remote.Mute();
        Console.WriteLine($"on={remote.On} volume={remote.Volume}");
    }
}

public class TvBasicRemote
{
    public bool On; public int Volume = 30;
    public void TogglePower() => On = !On;
    public void VolumeUp() => Volume += 10;
}
public class TvAdvancedRemote : TvBasicRemote { public void Mute() => Volume = 0; }

public class RadioBasicRemote // same logic, copied for the radio
{
    public bool On; public int Volume = 10;
    public void TogglePower() => On = !On;
    public void VolumeUp() => Volume += 10;
}
public class RadioAdvancedRemote : RadioBasicRemote { public void Mute() => Volume = 0; }
// Add a Speaker device: SpeakerBasicRemote and SpeakerAdvancedRemote.
// Add a VoiceRemote type: TvVoiceRemote, RadioVoiceRemote, SpeakerVoiceRemote...
