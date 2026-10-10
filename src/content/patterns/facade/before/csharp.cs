// Without the pattern: every caller drives all four components.
using System;

public static class Program
{
    public static void Main()
    {
        var lights = new Lights();
        var projector = new Projector();
        var amp = new Amplifier();
        var player = new Player();

        // Screen A starts a movie...
        lights.Dim(10);
        projector.On();
        amp.SetVolume(5);
        player.Play("Dune");

        // ...and a voice command, a schedule and a remote app repeat this recipe.
        // Forget projector.On() in one of them and you hear a movie with no picture.
    }
}

public class Lights { public void Dim(int l) => Console.WriteLine($"Lights dimmed to {l}%"); }
public class Projector { public void On() => Console.WriteLine("Projector on"); }
public class Amplifier { public void SetVolume(int v) => Console.WriteLine($"Amplifier volume {v}"); }
public class Player { public void Play(string m) => Console.WriteLine($"Playing \"{m}\""); }
