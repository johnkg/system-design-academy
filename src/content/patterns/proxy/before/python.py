# Without the pattern: the gallery loads every image up front.

class RealImage:
    def __init__(self, file):
        self.file = file
        print(f"Loading {file} from disk (slow)...")

    def display(self):
        print(f"Displaying {self.file}")


images = [RealImage(f) for f in ["a.jpg", "b.jpg", "c.jpg"]]  # all loaded now
print("Gallery ready (everything loaded, even photos nobody will open)")
images[1].display()
# With 100 photos: 100 slow loads and 100 images in memory before the first click.
