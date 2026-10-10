"""Quorum reads and writes in Python: N replicas, a write waits for W of them, a read asks R of them.
To show the worst case, a write reaches the FIRST W replicas and a read asks the LAST R replicas."""


class Cluster:
    def __init__(self, n):
        self.replicas = [{"version": 1, "value": "v1"} for _ in range(n)]

    def write(self, value, w):
        version = max(r["version"] for r in self.replicas) + 1
        reached = []
        for i in range(w):  # the other replicas are slow and miss it
            self.replicas[i] = {"version": version, "value": value}
            reached.append(i)
        return reached

    def read(self, r):
        asked = list(range(len(self.replicas)))[-r:]
        newest = max((self.replicas[i] for i in asked), key=lambda rep: rep["version"])  # newest version wins
        return asked, newest["value"]


def join(items):
    return ",".join(map(str, items))


def demo(n, w, r):
    cluster = Cluster(n)
    wrote = cluster.write("v2", w)
    asked, value = cluster.read(r)
    guaranteed = r + w > n
    print(f"N={n} W={w} R={r}: wrote [{join(wrote)}], read [{join(asked)}] -> {value}  "
          f"(R+W {'>' if guaranteed else '<='} N: {'fresh read guaranteed' if guaranteed else 'stale read possible'})")


demo(3, 2, 2)  # quorums overlap
demo(3, 1, 1)  # fastest, but can read stale data
demo(3, 3, 1)  # slow, fragile writes, but any single replica is up to date
demo(5, 3, 3)  # a common majority setting
demo(5, 2, 3)  # 5 is not greater than 5: stale read possible
