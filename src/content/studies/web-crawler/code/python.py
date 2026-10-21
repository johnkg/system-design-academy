# A polite crawl frontier in Python:
# URLs are cleaned up so the same page is not fetched twice, and each site gets its own queue with a minimum gap between requests.
import re
import sys
from urllib.parse import urlsplit

DEFAULT_PORTS = {"http": 80, "https": 443}


# Different spellings of one page become one string: host in lower case, no default port, no #fragment, no trailing slash.
def normalize(raw):
    u = urlsplit(raw)
    scheme = u.scheme.lower()
    host = u.hostname
    if u.port is not None and u.port != DEFAULT_PORTS.get(scheme):
        host = f"{host}:{u.port}"
    path = re.sub(r"/+$", "", u.path) or "/"
    search = f"?{u.query}" if u.query else ""
    return f"{scheme}://{host}{path}{search}"


def host_of(url):
    return urlsplit(url).netloc


class Frontier:
    def __init__(self, gap_seconds):
        self.gap = gap_seconds
        self.seen = set()  # every URL ever added
        self.queues = {}  # host -> URLs waiting for that host
        self.next_allowed = {}  # host -> the earliest time we may fetch from it again

    def add(self, raw):
        url = normalize(raw)
        if url in self.seen:
            return
        self.seen.add(url)
        host = host_of(url)
        if host not in self.queues:
            self.queues[host] = []
        self.queues[host].append(url)

    # The next URL whose site is not being rested, or None if every site with work is waiting.
    def next(self, now):
        for host, queue in list(self.queues.items()):
            if not queue or self.next_allowed.get(host, 0) > now:
                continue
            self.next_allowed[host] = now + self.gap
            del self.queues[host]
            self.queues[host] = queue  # move this host to the back, so the others get a turn
            return queue.pop(0)
        return None

    @property
    def pending(self):
        return sum(len(q) for q in self.queues.values())


# A tiny pretend web: every page and the links found on it, written the messy way real pages write them.
web = {
    "http://a.com/": ["http://a.com/p1", "http://a.com/p2", "HTTP://B.com:80/#top", "http://c.com/"],
    "http://a.com/p1": ["http://a.com/", "http://a.com/p2/", "http://b.com/x"],
    "http://a.com/p2": ["http://a.com/p1#section", "http://c.com/y"],
    "http://b.com/": ["http://a.com/", "http://b.com/x", "http://b.com/y"],
    "http://b.com/x": ["http://b.com/"],
    "http://b.com/y": ["http://b.com/x"],
    "http://c.com/": ["http://c.com/y", "http://a.com/p1"],
    "http://c.com/y": [],
}

GAP = 2  # seconds between requests to one site
WORKERS = 2  # fetches that can run at the same moment
MAX_SECONDS = 60  # stop the crawl after this long
frontier = Frontier(GAP)
frontier.add("http://a.com/")

fetched_at = {}
last_time = {}
too_soon = 0
t = 0
while t < MAX_SECONDS and frontier.pending > 0:
    for _ in range(WORKERS):
        url = frontier.next(t)
        if not url:
            break
        if url in fetched_at:
            sys.exit(1)  # a page fetched twice
        fetched_at[url] = t
        host = host_of(url)
        if host in last_time and t - last_time[host] < GAP:
            too_soon += 1  # a site hit again too soon
        last_time[host] = t
        print(f"t={t:>2}s  fetched {url}")
        for link in web.get(url, []):
            frontier.add(link)  # parse the page and queue its links
    t += 1
print(f"pages fetched: {len(fetched_at)} of {len(web)}   requests sent too soon: {too_soon}")
if len(fetched_at) != len(web) or too_soon > 0:
    sys.exit(1)
