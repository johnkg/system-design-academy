# A news feed that mixes pushed and pulled posts in Python:
# ordinary authors are pushed into followers' feed lists, popular authors are pulled and merged when the feed is read.
from dataclasses import dataclass
from math import inf


@dataclass
class Post:
    id: int
    author: str
    text: str


@dataclass
class FeedPage:
    page: list
    next_cursor: int | None


class FeedService:
    def __init__(self, popular_threshold):
        self.popular_threshold = popular_threshold
        self._followers = {}  # author -> dict used as an ordered set of users
        self._following = {}  # user -> dict used as an ordered set of authors
        self._feeds = {}      # user -> post ids, newest first (the precomputed feed list)
        self._by_author = {}  # author -> posts, newest last
        self._posts = {}      # post id -> post
        self._clock = 0

    @staticmethod
    def _set(mapping, key):
        return mapping.setdefault(key, {})

    def follow(self, user, author):
        self._set(self._followers, author)[user] = True
        self._set(self._following, user)[author] = True

    def is_popular(self, author):
        return len(self._set(self._followers, author)) >= self.popular_threshold

    # Store the post once. Push it to followers' lists only when the author is not popular.
    def publish(self, author, text):
        self._clock += 1
        post = Post(self._clock, author, text)
        self._posts[post.id] = post
        self._by_author.setdefault(author, []).append(post)
        if self.is_popular(author):
            return 0
        followers = self._set(self._followers, author)
        for user in followers:
            self._feeds.setdefault(user, []).insert(0, post.id)
        return len(followers)

    # Merge the precomputed list with the latest posts of popular authors, remove duplicates,
    # and return one page. The cursor is the id of the last post shown, so new posts cannot shift the page.
    def feed(self, user, limit, cursor=inf):
        ids = set(self._feeds.get(user, []))
        for author in self._set(self._following, user):
            if self.is_popular(author):
                ids.update(post.id for post in self._by_author.get(author, []))
        page = [self._posts[i] for i in sorted((i for i in ids if i < cursor), reverse=True)[:limit]]
        return FeedPage(page, page[-1].id if len(page) == limit else None)


def show(r):
    next_cursor = 'null' if r.next_cursor is None else r.next_cursor
    return ' | '.join(f'{p.id}:{p.author}:{p.text}' for p in r.page) + f'  (next cursor: {next_cursor})'


POPULAR_FOLLOWERS = 3  # an author with 3 or more followers counts as popular, to keep the demo small
PAGE_SIZE = 2
svc = FeedService(POPULAR_FOLLOWERS)
svc.follow("ann", "bob")
svc.follow("dan", "bob")
for user in ["ann", "dan", "eve"]:
    svc.follow(user, "cat")  # cat becomes popular

print("bob posts 'lunch':       ", f"pushed to {svc.publish('bob', 'lunch')} feeds")
print("cat posts 'big news':    ", f"pushed to {svc.publish('cat', 'big news')} feeds")
print("bob posts 'coffee':      ", f"pushed to {svc.publish('bob', 'coffee')} feeds")

first = svc.feed("ann", PAGE_SIZE)
print("ann page 1:              ", show(first))
print("ann page 2:              ", show(svc.feed("ann", PAGE_SIZE, first.next_cursor)))
print("eve page 1:              ", show(svc.feed("eve", PAGE_SIZE)))
