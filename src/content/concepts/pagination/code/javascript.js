// Offset and cursor pagination in JavaScript, with a new post arriving between two page loads.

class PostStore {
  posts = []; // newest first
  constructor(count) { for (let id = count; id >= 1; id--) this.posts.push({ id }); }
  add() { this.posts.unshift({ id: this.posts[0].id + 1 }); }

  // OFFSET n LIMIT m: skip rows, then take some
  byOffset(offset, limit) {
    return this.posts.slice(offset, offset + limit).map((p) => p.id);
  }

  // WHERE id < cursor LIMIT m: continue after the last id the client saw
  byCursor(cursor, limit) {
    const rows = this.posts.filter((p) => cursor === null || p.id < cursor).slice(0, limit).map((p) => p.id);
    return { ids: rows, next: rows.length ? rows[rows.length - 1] : null };
  }
}

const LIMIT = 5;

const offsetStore = new PostStore(20);
console.log("offset pagination");
console.log(`  page 1: ${offsetStore.byOffset(0, LIMIT)}`);
offsetStore.add(); // post 21 is published while the client reads
console.log(`  page 2: ${offsetStore.byOffset(LIMIT, LIMIT)}   <- 16 appears again`);

const cursorStore = new PostStore(20);
console.log("cursor pagination");
const first = cursorStore.byCursor(null, LIMIT);
console.log(`  page 1: ${first.ids}`);
cursorStore.add(); // the same new post
const second = cursorStore.byCursor(first.next, LIMIT);
console.log(`  page 2: ${second.ids}   <- continues exactly after 16`);
