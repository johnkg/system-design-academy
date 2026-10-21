// Without the pattern: one class for every remote x device combination.
using System;

public static class Program
{
    public const int TvStartVolume = 30, RadioStartVolume = 10;
    public const int VolumeStep = 10;

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
    public bool On; public int Volume = Program.TvStartVolume;
    public void TogglePower() => On = !On;
    public void VolumeUp() => Volume += Program.VolumeStep;
}
public class TvAdvancedRemote : TvBasicRemote { public void Mute() => Volume = 0; }

public class RadioBasicRemote // same logic, copied for the radio
{
    public bool On; public int Volume = Program.RadioStartVolume;
    public void TogglePower() => On = !On;
    public void VolumeUp() => Volume += Program.VolumeStep;
}
public class RadioAdvancedRemote : RadioBasicRemote { public void Mute() => Volume = 0; }
// Add a Speaker device: SpeakerBasicRemote and SpeakerAdvancedRemote.
// Add a VoiceRemote type: TvVoiceRemote, RadioVoiceRemote, SpeakerVoiceRemote...
