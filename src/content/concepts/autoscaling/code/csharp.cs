// A target-tracking autoscaler with warm-up, cooldown and min/max bounds, run over a fixed traffic series.
// One step is one minute. Everything is integers, so the output is identical in every language.
using System;
using System.Collections.Generic;
using System.Linq;

const int Capacity = 100; // requests per second one warm instance can serve
int targetPercent = 60, warmup = 2, cooldown = 2, min = 2, max = 12;

// Requests per second: quiet, a sharp spike, then a quiet night.
int[] traffic = { 150, 160, 150, 170, 400, 800, 1000, 1000, 1000, 900, 700, 500, 300, 200, 150,
    140, 150, 160, 150, 140, 80, 70, 80, 70, 80, 70, 80, 70, 80, 70 };

int DesiredInstances(int load)
{
    // Enough instances that each one runs at the target utilisation: ceil(load / (capacity * target)).
    int perInstance = Capacity * targetPercent;
    return (load * 100 + perInstance - 1) / perInstance;
}

int ready = min; // warm instances that serve traffic
var warming = new List<int>(); // minute at which each launched instance becomes ready
int cooldownLeft = 0, instanceMinutes = 0, dropped = 0, overloaded = 0, actions = 0, peak = ready;

for (int minute = 0; minute < traffic.Length; minute++)
{
    int load = traffic[minute];
    ready += warming.Count(at => at <= minute);
    warming = warming.Where(at => at > minute).ToList();
    int total = ready + warming.Count;

    int served = Math.Min(load, ready * Capacity);
    dropped += (load - served) * 60;
    if (load > ready * Capacity) overloaded++;
    instanceMinutes += total; // you pay for instances while they warm up
    peak = Math.Max(peak, total);
    int readyNow = ready;
    int util = load * 100 / (ready * Capacity);

    // Decide: clamp to the bounds, and stay quiet during the cooldown.
    int desired = Math.Max(min, Math.Min(max, DesiredInstances(load)));
    string action = "hold";
    if (cooldownLeft > 0)
    {
        cooldownLeft--;
    }
    else if (desired > total)
    {
        for (int i = 0; i < desired - total; i++) warming.Add(minute + 1 + warmup);
        action = $"out +{desired - total}";
        cooldownLeft = cooldown;
    }
    else if (desired < total)
    {
        int remove = total - desired;
        while (remove > 0 && warming.Count > 0) { warming.RemoveAt(warming.Count - 1); remove--; } // drop the newest first
        ready -= remove;
        action = $"in -{total - desired}";
        cooldownLeft = cooldown;
    }
    if (action != "hold") actions++;
    Console.WriteLine($"min {minute,2} load {load,4} ready {readyNow,2} total {total,2} util {util,3}% {action}");
}

Console.WriteLine($"instance-minutes {instanceMinutes}, dropped or slow requests {dropped}");
Console.WriteLine($"overloaded minutes {overloaded}, scaling actions {actions}, peak instances {peak}");

// Invariants: bounds respected, and the spike really did cause some overload while instances warmed up.
if (peak > max || peak < min) return 1;
if (overloaded == 0 || instanceMinutes < traffic.Length * min) return 1;
return 0;
