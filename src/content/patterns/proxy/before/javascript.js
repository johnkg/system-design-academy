// Without the pattern: the gallery loads every image up front.

class RealImage {
  constructor(file) {
    this.file = file;
    console.log(`Loading ${file} from disk (slow)...`);
  }
  display() { console.log(`Displaying ${this.file}`); }
}

const images = ["a.jpg", "b.jpg", "c.jpg"].map((f) => new RealImage(f)); // all loaded now
console.log("Gallery ready (everything loaded, even photos nobody will open)");
images[1].display();
// With 100 photos: 100 slow loads and 100 images in memory before the first click.
