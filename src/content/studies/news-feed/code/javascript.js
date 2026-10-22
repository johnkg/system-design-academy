// A news feed that mixes pushed and pulled posts in JavaScript:
// ordinary authors are pushed into followers' feed lists, popular authors are pulled and merged when the feed is read.

class FeedService {
  #followers = new Map(); // author -> Set of users
  #following = new Map(); // user -> Set of authors
  #feeds = new Map(); // user -> post ids, newest first (the precomputed feed list)
  #byAuthor = new Map(); // author -> posts, newest last
  #posts = new Map(); // post id -> post
  #clock = 0;

  constructor(popularThreshold) {
    this.popularThreshold = popularThreshold;
  }

  #set(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  follow(user, author) {
    this.#set(this.#followers, author).add(user);
    this.#set(this.#following, user).add(author);
  }

  isPopular(author) {
    return this.#set(this.#followers, author).size >= this.popularThreshold;
  }

  // Store the post once. Push it to followers' lists only when the author is not popular.
  publish(author, text) {
    const post = { id: ++this.#clock, author, text };
    this.#posts.set(post.id, post);
    if (!this.#byAuthor.has(author)) this.#byAuthor.set(author, []);
    this.#byAuthor.get(author).push(post);
    if (this.isPopular(author)) return 0;
    const followers = this.#set(this.#followers, author);
    for (const user of followers) {
      if (!this.#feeds.has(user)) this.#feeds.set(user, []);
      this.#feeds.get(user).unshift(post.id);
    }
    return followers.size;
  }

  // Merge the precomputed list with the latest posts of popular authors, remove duplicates,
  // and return one page. The cursor is the id of the last post shown, so new posts cannot shift the page.
  feed(user, limit, cursor = Infinity) {
    const ids = new Set(this.#feeds.get(user) ?? []);
    for (const author of this.#set(this.#following, user)) {
      if (this.isPopular(author)) for (const post of this.#byAuthor.get(author) ?? []) ids.add(post.id);
    }
    const page = [...ids]
      .filter((id) => id < cursor)
      .sort((a, b) => b - a)
      .slice(0, limit)
      .map((id) => this.#posts.get(id));
    return { page, nextCursor: page.length === limit ? page[page.length - 1].id : null };
  }
}

const show = (r) => r.page.map((p) => `${p.id}:${p.author}:${p.text}`).join(" | ") + `  (next cursor: ${r.nextCursor})`;

const POPULAR_FOLLOWERS = 3; // an author with 3 or more followers counts as popular, to keep the demo small
const PAGE_SIZE = 2;
const svc = new FeedService(POPULAR_FOLLOWERS);
svc.follow("ann", "bob");
svc.follow("dan", "bob");
for (const user of ["ann", "dan", "eve"]) svc.follow(user, "cat"); // cat becomes popular

console.log("bob posts 'lunch':       ", `pushed to ${svc.publish("bob", "lunch")} feeds`);
console.log("cat posts 'big news':    ", `pushed to ${svc.publish("cat", "big news")} feeds`);
console.log("bob posts 'coffee':      ", `pushed to ${svc.publish("bob", "coffee")} feeds`);

const first = svc.feed("ann", PAGE_SIZE);
console.log("ann page 1:              ", show(first));
console.log("ann page 2:              ", show(svc.feed("ann", PAGE_SIZE, first.nextCursor)));
console.log("eve page 1:              ", show(svc.feed("eve", PAGE_SIZE)));
