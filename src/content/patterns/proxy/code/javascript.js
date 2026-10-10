// Proxy in JavaScript. A virtual proxy that loads the real image lazily.

class RealImage { // Real Subject
  constructor(file) {
    this.file = file;
    console.log(`Loading ${file} from disk (slow)...`);
  }
  display() { console.log(`Displaying ${this.file}`); }
}

class ImageProxy { // Proxy: same interface as RealImage
  #real = null;
  constructor(file) { this.file = file; }

  display() {
    this.#real ??= new RealImage(this.file); // create on first use only
    this.#real.display();
  }
}

class Gallery { // Client: works with anything that has display()
  constructor(images) { this.images = images; }
  show(index) { this.images[index].display(); }
}

const gallery = new Gallery(["a.jpg", "b.jpg", "c.jpg"].map((f) => new ImageProxy(f)));
console.log("Gallery ready (nothing loaded yet)");
gallery.show(1); // loads b.jpg
gallery.show(1); // already loaded: displays only
