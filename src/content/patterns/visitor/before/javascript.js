// Without the pattern: every operation is a method on every shape.

class Circle {
  constructor(radius) { this.radius = radius; }
  area() { return Math.PI * this.radius ** 2; }
  perimeter() { return 2 * Math.PI * this.radius; }
  describe() { return `circle r=${this.radius}`; }
  // toJson(), toSvg(), draw()... every new operation lands here
}

class Rectangle {
  constructor(width, height) { this.width = width; this.height = height; }
  area() { return this.width * this.height; }
  perimeter() { return 2 * (this.width + this.height); }
  describe() { return `rectangle ${this.width}x${this.height}`; }
  // ...and here, and in every other shape class
}

const shapes = [new Circle(2), new Rectangle(3, 4)];
console.log(shapes.map((s) => s.area()), shapes.map((s) => s.perimeter()), shapes.map((s) => s.describe()));
// Add a Triangle: easy. Add toSvg(): edit every shape. The alternative, instanceof chains,
// silently ignores any shape you forgot.
