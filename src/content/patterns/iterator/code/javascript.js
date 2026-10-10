// Iterator in JavaScript. Hand-written for teaching; JS also has built-in iterators and generators.

class ForwardIterator { // Concrete Iterator
  #songs; #index = 0;
  constructor(songs) { this.#songs = songs; }
  hasNext() { return this.#index < this.#songs.length; }
  next() { return this.#songs[this.#index++]; }
}

class ReverseIterator { // Concrete Iterator
  #songs; #index;
  constructor(songs) { this.#songs = songs; this.#index = songs.length - 1; }
  hasNext() { return this.#index >= 0; }
  next() { return this.#songs[this.#index--]; }
}

class Playlist { // Aggregate: hides how songs are stored
  #songs = [];
  add(song) { this.#songs.push(song); return this; }
  createIterator() { return new ForwardIterator(this.#songs); }
  createReverseIterator() { return new ReverseIterator(this.#songs); }
}

const playlist = new Playlist().add("Intro").add("Verse").add("Chorus");

const forward = playlist.createIterator(); // Client
while (forward.hasNext()) console.log(forward.next());   // Intro, Verse, Chorus

const reverse = playlist.createReverseIterator();
const other = playlist.createIterator();                  // independent position
console.log(reverse.next(), other.next());                // Chorus Intro
