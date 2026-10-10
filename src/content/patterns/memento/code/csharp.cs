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

    public Snapshot Save() => new(_hp, _level);
    public void Restore(Snapshot s) { _hp = s.Hp; _level = s.Level; }

    // Memento: nested so only Player can read its fields. Everyone else sees an opaque object.
    public sealed class Snapshot
    {
        internal int Hp { get; }
        internal int Level { get; }
        internal Snapshot(int hp, int level) { Hp = hp; Level = level; }
    }
}

public class CheckpointManager // Caretaker: stores, never inspects
{
    private readonly Stack<Player.Snapshot> _stack = new();
    public void Save(Player player) => _stack.Push(player.Save());
    public void LoadLast(Player player) { if (_stack.TryPop(out var s)) player.Restore(s); }
}
