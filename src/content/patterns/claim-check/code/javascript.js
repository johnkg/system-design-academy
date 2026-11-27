// Claim Check in JavaScript. The queue carries a small ticket; the heavy payload goes to storage.

class BlobStore { // Payload store
  #blobs = new Map();
  #next = 1;
  put(payload) { const id = `blob-${this.#next++}`; this.#blobs.set(id, payload); return id; }
  get(id) { return this.#blobs.get(id); }
  delete(id) { this.#blobs.delete(id); }
  get count() { return this.#blobs.size; }
}

const store = new BlobStore();
const queue = [];

function produce(video) { // Producer: store the payload, send only the ticket
  const ticket = store.put(video);
  queue.push({ ticket });
  console.log(`Producer stored ${video.sizeKb} KB as ${ticket}`);
  console.log(`Queue message carries ticket ${ticket} only`);
}

function consume() { // Consumer: claim the payload with the ticket
  const { ticket } = queue.shift();
  const video = store.get(ticket);
  console.log(`Consumer fetched ${ticket} (${video.sizeKb} KB) and processed ${video.name}`);
  store.delete(ticket); // only after success
  console.log(`Consumer deleted ${ticket}`);
}

produce({ name: "holiday.mp4", sizeKb: 20000 });
consume();
console.log(`Blobs left in the store: ${store.count}`);
