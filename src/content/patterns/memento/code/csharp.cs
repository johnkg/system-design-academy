// Memento in C#. The player makes and restores snapshots; the manager only stores them.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var player = new Player();
        var checkpoints = new CheckpointManager();

        checkpoints.Save(player);          // HP 100, level 1
        player.TakeDamage(70);
        player.LevelUp();
        Console.WriteLine(player.Describe()); // HP 30, level 2
        checkpoints.LoadLast(player);
        Console.WriteLine(player.Describe()); // HP 100, level 1
    }
}

public class Player // Originator
{
    private int _hp = 100;
    private int _level = 1;

    public void TakeDamage(int amount) => _hp = Math.Max(0, _hp - amount);
    public void LevelUp() => _level++;
    public string Describe() => $"HP {_hp}, level {_level}";

    public IPlayerSnapshot Save() => new Snapshot(_hp, _level);
    public void Restore(IPlayerSnapshot s) { var snap = (Snapshot)s; _hp = snap.Hp; _level = snap.Level; }

    // Memento: a private nested class, so only Player can see its fields.
    // Everyone else only gets the empty IPlayerSnapshot interface.
    private sealed class Snapshot(int hp, int level) : IPlayerSnapshot
    {
        public int Hp { get; } = hp;
        public int Level { get; } = level;
    }
}

public interface IPlayerSnapshot { } // the narrow, opaque view the caretaker holds

public class CheckpointManager // Caretaker: stores, never inspects
{
    private readonly Stack<IPlayerSnapshot> _stack = new();
    public void Save(Player player) => _stack.Push(player.Save());
    public void LoadLast(Player player) { if (_stack.TryPop(out var s)) player.Restore(s); }
}
