// Load balancing in C#: pluggable strategies, health checks, and a balancer.
using System;
using System.Collections.Generic;
using System.Linq;

public static class Program
{
    public static void Main()
    {
        var servers = new List<Server> { new("A"), new("B"), new("C") };
        var balancer = new LoadBalancer(servers, new RoundRobin());

        Console.WriteLine(string.Join(", ", new[] { "r1", "r2", "r3", "r4" }.Select(balancer.Route))); // A, B, C, A
        servers[1].Healthy = false; // B fails its health check
        Console.WriteLine(string.Join(", ", new[] { "r5", "r6", "r7" }.Select(balancer.Route)));       // B is skipped

        balancer.Strategy = new LeastConnections();
        servers[0].Active = 10;                   // A is busy
        Console.WriteLine(balancer.Route("r8"));  // goes to C, the least busy healthy server
    }
}

public class Server(string name)
{
    public string Name { get; } = name;
    public int Active { get; set; }
    public bool Healthy { get; set; } = true;
}

public interface IBalancingStrategy
{
    Server Pick(IReadOnlyList<Server> servers);
}

public class RoundRobin : IBalancingStrategy // takes turns among healthy servers
{
    private int _next;
    public Server Pick(IReadOnlyList<Server> servers) => servers[_next++ % servers.Count];
}

public class LeastConnections : IBalancingStrategy // fewest requests in flight
{
    public Server Pick(IReadOnlyList<Server> servers) => servers.MinBy(s => s.Active)!;
}

public class LoadBalancer(List<Server> servers, IBalancingStrategy strategy)
{
    public IBalancingStrategy Strategy { get; set; } = strategy;

    public string Route(string request)
    {
        var healthy = servers.Where(s => s.Healthy).ToList(); // health checks keep dead servers out
        if (healthy.Count == 0) throw new InvalidOperationException("503: no healthy servers");
        var server = Strategy.Pick(healthy);
        server.Active++;
        return $"{request} -> {server.Name}";
    }
}
