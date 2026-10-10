// Facade in C#. HomeTheater hides the four-step recipe.
using System;

public static class Program
{
    public static void Main()
    {
        var theater = new HomeTheater(new Lights(), new Projector(), new Amplifier(), new Player());
        theater.WatchMovie("Dune"); // the client's whole job
        theater.EndMovie();
    }
}

public class Lights // Subsystem
{
    public void Dim(int level) => Console.WriteLine($"Lights dimmed to {level}%");
    public void On() => Console.WriteLine("Lights on");
}

public class Projector // Subsystem
{
    public void On() => Console.WriteLine("Projector on");
    public void Off() => Console.WriteLine("Projector off");
}

public class Amplifier // Subsystem
{
    public void SetVolume(int level) => Console.WriteLine($"Amplifier volume {level}");
}

public class Player // Subsystem
{
    public void Play(string movie) => Console.WriteLine($"Playing \"{movie}\"");
    public void Stop() => Console.WriteLine("Player stopped");
}

public class HomeTheater(Lights lights, Projector projector, Amplifier amp, Player player) // Facade
{
    public void WatchMovie(string movie)
    {
        lights.Dim(10);       // the recipe, in the right order
        projector.On();
        amp.SetVolume(5);
        player.Play(movie);
    }

    public void EndMovie()
    {
        player.Stop();
        projector.Off();
        lights.On();
    }
}
