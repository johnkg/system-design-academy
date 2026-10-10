// Load balancing in JavaScript: pluggable strategies, health checks, and a balancer.

class RoundRobin { // takes turns among healthy servers
  #next = 0;
  pick(servers) {
    return servers[this.#next++ % servers.length];
  }
}

class LeastConnections { // picks the server with the fewest requests in flight
  pick(servers) {
    return servers.reduce((best, s) => (s.active < best.active ? s : best));
  }
}

class Server {
  active = 0;
  healthy = true;
  constructor(name) { this.name = name; }
}

class LoadBalancer {
  constructor(servers, strategy) { this.servers = servers; this.strategy = strategy; }

  route(request) {
    const healthy = this.servers.filter((s) => s.healthy); // health checks keep dead servers out
    if (healthy.length === 0) throw new Error("503: no healthy servers");
    const server = this.strategy.pick(healthy);
    server.active++;
    return `${request} -> ${server.name}`;
  }
}

const servers = [new Server("A"), new Server("B"), new Server("C")];
const balancer = new LoadBalancer(servers, new RoundRobin());

console.log(["r1", "r2", "r3", "r4"].map((r) => balancer.route(r)).join(", ")); // A, B, C, A
servers[1].healthy = false; // B fails its health check
console.log(["r5", "r6", "r7"].map((r) => balancer.route(r)).join(", "));       // B is skipped

balancer.strategy = new LeastConnections();
servers[0].active = 10;                    // A is busy
console.log(balancer.route("r8"));         // goes to C, the least busy healthy server
