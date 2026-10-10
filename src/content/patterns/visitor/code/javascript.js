// Visitor in JavaScript. Operations live in visitors; shapes only know accept().

class Circle { // Concrete Element
  constructor(radius) { this.radius = radius; }
  accept(visitor) { return visitor.visitCircle(this); } // double dispatch
}

class Rectangle { // Concrete Element
  constructor(width, height) { this.width = width; this.height = height; }
  accept(visitor) { return visitor.visitRectangle(this); }
}

class AreaVisitor { // Concrete Visitor: one operation across all shapes
  visitCircle(c) { return Math.PI * c.radius ** 2; }
  visitRectangle(r) { return r.width * r.height; }
}

class PerimeterVisitor { // Concrete Visitor
  visitCircle(c) { return 2 * Math.PI * c.radius; }
  visitRectangle(r) { return 2 * (r.width + r.height); }
}

class DescribeVisitor { // A brand new operation: shapes were not touched
  visitCircle(c) { return `circle r=${c.radius}`; }
  visitRectangle(r) { return `rectangle ${r.width}x${r.height}`; }
}

const shapes = [new Circle(2), new Rectangle(3, 4)];
for (const visitor of [new AreaVisitor(), new PerimeterVisitor(), new DescribeVisitor()]) {
  console.log(visitor.constructor.name, shapes.map((s) => s.accept(visitor)));
}
