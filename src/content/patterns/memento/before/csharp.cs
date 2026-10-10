// Without the pattern: the save code reaches into the player's fields.
using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        var player = new Player();
        var saves = new Stack<(int Hp, int Level)>();

        saves.Push((player.Hp, player.Level)); // must know every field
        player.Hp -= 70;
        player.Level++;

        var last = saves.Pop();
        player.Hp = last.Hp;                    // and write each one back
        player.Level = last.Level;
        Console.WriteLine($"HP {player.Hp}, level {player.Level}");

        // Add "Inventory" to Player and forget to update the saver: saves silently lose it.
        // Any code can also set player.Hp = 9999 directly.
    }
}

public class Player
{
    public int Hp = 100;    // everything public so the saver can touch it
    public int Level = 1;
}
