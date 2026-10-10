"""Load balancing in Python: pluggable strategies, health checks, and a balancer."""


class RoundRobin:  # takes turns among healthy servers
    def __init__(self):
        self._next = 0

    def pick(self, servers):
        server = servers[self._next % len(servers)]
        self._next += 1
        return server


class LeastConnections:  # picks the server with the fewest requests in flight
    def pick(self, servers):
        best = servers[0]
        for s in servers[1:]:
            if s.active < best.active:
                best = s
        return best


class Server:
    def __init__(self, name):
        self.name = name
        self.active = 0
        self.healthy = True


class LoadBalancer:
    def __init__(self, servers, strategy):
        self.servers = servers
        self.strategy = strategy

    def route(self, request):
        healthy = [s for s in self.servers if s.healthy]  # health checks keep dead servers out
        if not healthy:
            raise RuntimeError("503: no healthy servers")
        server = self.strategy.pick(healthy)
        server.active += 1
        return f"{request} -> {server.name}"


servers = [Server("A"), Server("B"), Server("C")]
balancer = LoadBalancer(servers, RoundRobin())

print(", ".join(balancer.route(r) for r in ["r1", "r2", "r3", "r4"]))  # A, B, C, A
servers[1].healthy = False  # B fails its health check
print(", ".join(balancer.route(r) for r in ["r5", "r6", "r7"]))  # B is skipped

balancer.strategy = LeastConnections()
servers[0].active = 10  # A is busy
print(balancer.route("r8"))  # goes to C, the least busy healthy server
