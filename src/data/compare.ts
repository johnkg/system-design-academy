/**
 * Hand-written guidance for the compare page.
 * Pattern slugs are validated at build time (see pages/compare.astro): a typo fails the build.
 */

export interface Problem {
  text: string; // "I need to..." phrased as the reader's goal
  patterns: { slug: string; why: string }[];
}

export interface Confusion {
  title: string;
  blurb: string;
  patterns: string[]; // column order
  rows: { aspect: string; values: string[] }[]; // values align with `patterns`
  rule: string; // rule of thumb
}

export const problems: Problem[] = [
  { text: 'Create objects without hard-coding their concrete classes', patterns: [
    { slug: 'factory-method', why: 'A subclass decides which single product to create.' },
    { slug: 'abstract-factory', why: 'One factory creates a whole family of related products.' } ] },
  { text: 'Guarantee that related objects always come from the same family (a theme, a platform)', patterns: [
    { slug: 'abstract-factory', why: 'The factory only produces one consistent family.' } ] },
  { text: 'Build an object that has many optional parts, readably', patterns: [
    { slug: 'builder', why: 'Named steps plus a final build() that validates.' } ] },
  { text: 'Create many objects that are slight variations of a configured template', patterns: [
    { slug: 'prototype', why: 'Clone the template instead of rebuilding it.' } ] },
  { text: 'Make sure there is exactly one shared instance of something', patterns: [
    { slug: 'singleton', why: 'Hidden constructor plus one access point.' } ] },
  { text: 'Swap one algorithm for another at runtime', patterns: [
    { slug: 'strategy', why: 'The algorithm is an object the caller can replace.' } ] },
  { text: 'Change an object\'s behaviour automatically as its internal state changes', patterns: [
    { slug: 'state', why: 'Each state is a class that decides what actions do.' } ] },
  { text: 'Keep the order of an algorithm fixed while letting subclasses customise some steps', patterns: [
    { slug: 'template-method', why: 'The base class owns the skeleton; subclasses fill in steps.' } ] },
  { text: 'Tell many objects when something changes, without knowing who they are', patterns: [
    { slug: 'observer', why: 'Subjects broadcast to a list of subscribers.' } ] },
  { text: 'Untangle objects that all talk directly to each other', patterns: [
    { slug: 'mediator', why: 'A central hub routes and coordinates the conversation.' } ] },
  { text: 'Support undo, redo, queuing or logging of user actions', patterns: [
    { slug: 'command', why: 'Each action becomes an object with execute() and undo().' },
    { slug: 'memento', why: 'Alternative: restore saved snapshots instead of reversing steps.' } ] },
  { text: 'Save a snapshot of an object and restore it later, without exposing its fields', patterns: [
    { slug: 'memento', why: 'The object creates and reads its own opaque snapshots.' } ] },
  { text: 'Pass a request along several possible handlers until one deals with it', patterns: [
    { slug: 'chain-of-responsibility', why: 'Each handler handles the request or passes it on.' } ] },
  { text: 'Walk through a collection without exposing how it is stored', patterns: [
    { slug: 'iterator', why: 'An iterator object remembers its own position.' } ] },
  { text: 'Add new operations to a family of classes without editing them', patterns: [
    { slug: 'visitor', why: 'Each operation lives in a visitor that handles every class.' } ] },
  { text: 'Evaluate expressions or rules written in a small, simple language', patterns: [
    { slug: 'interpreter', why: 'Each grammar rule is a class; evaluation walks the tree.' } ] },
  { text: 'Use a class or library whose interface does not match what my code expects', patterns: [
    { slug: 'adapter', why: 'A wrapper translates calls to the interface you need.' },
    { slug: 'facade', why: 'If the real goal is simplifying a complex library, not converting it.' } ] },
  { text: 'Add behaviour to individual objects, in any combination, at runtime', patterns: [
    { slug: 'decorator', why: 'Wrap objects in layers that share the same interface.' } ] },
  { text: 'Give a complicated subsystem one simple entry point', patterns: [
    { slug: 'facade', why: 'A facade exposes the few operations most clients need.' } ] },
  { text: 'Treat a single item and a group of items the same way (trees of parts)', patterns: [
    { slug: 'composite', why: 'Leaves and containers share one interface.' } ] },
  { text: 'Vary two independent things (for example remote type and device) without a class for every pair', patterns: [
    { slug: 'bridge', why: 'Two separate hierarchies connected by a reference.' } ] },
  { text: 'Delay creating an expensive object, cache its results, or check access before using it', patterns: [
    { slug: 'proxy', why: 'A stand-in with the same interface controls access.' } ] },
  { text: 'Save memory when there are thousands of similar objects', patterns: [
    { slug: 'flyweight', why: 'Share the identical, immutable part between all of them.' } ] },
  { text: 'Avoid a class explosion from combining optional features', patterns: [
    { slug: 'decorator', why: 'Stack small wrappers instead of one class per combination.' },
    { slug: 'bridge', why: 'When the combinations come from two independent dimensions.' } ] },
  { text: 'Replace a long if/else or switch that picks behaviour by type or status', patterns: [
    { slug: 'strategy', why: 'If the caller chooses which behaviour to use.' },
    { slug: 'state', why: 'If the object\'s own state decides the behaviour.' } ] },
  { text: 'Decouple whoever triggers something from whoever handles it', patterns: [
    { slug: 'observer', why: 'One-to-many notification.' },
    { slug: 'command', why: 'The request itself becomes a passable object.' },
    { slug: 'chain-of-responsibility', why: 'The sender does not know which handler will act.' },
    { slug: 'mediator', why: 'Everyone talks to a hub instead of to each other.' } ] },
  { text: 'Wrap a service to add logging, permissions or caching without changing it', patterns: [
    { slug: 'proxy', why: 'When you are controlling access to the same object.' },
    { slug: 'decorator', why: 'When you are adding stackable behaviour.' } ] },
  { text: 'Make code easier to test by swapping out the pieces it depends on', patterns: [
    { slug: 'strategy', why: 'Inject a fake algorithm.' },
    { slug: 'factory-method', why: 'Override the creation step to return a fake.' },
    { slug: 'abstract-factory', why: 'Hand the client a factory of test doubles.' } ] },
];

export const confusions: Confusion[] = [
  {
    title: 'The four wrappers: Adapter, Facade, Proxy, Decorator',
    blurb: 'All four put one object in front of another. They differ in what the front looks like and why it exists.',
    patterns: ['adapter', 'facade', 'proxy', 'decorator'],
    rows: [
      { aspect: 'Interface it presents', values: ['A different one, the one your code expects', 'A new, simpler one', 'The same as the real object', 'The same as the wrapped object'] },
      { aspect: 'How many objects it wraps', values: ['One', 'Many (a subsystem)', 'One', 'One (which may itself be wrapped)'] },
      { aspect: 'Main purpose', values: ['Make incompatible things work together', 'Hide complexity', 'Control access: lazy, cached, protected, remote', 'Add behaviour in layers'] },
      { aspect: 'Client knows about it?', values: ['Yes, it asks for the target interface', 'Yes, it is the entry point', 'No, it thinks it has the real object', 'Usually no'] },
    ],
    rule: 'Different interface? Adapter. Simpler interface over many classes? Facade. Same interface, controlling access? Proxy. Same interface, adding behaviour? Decorator.',
  },
  {
    title: 'Strategy vs State',
    blurb: 'Same structure on paper: a context delegates to an interchangeable object. The difference is who changes it and why.',
    patterns: ['strategy', 'state'],
    rows: [
      { aspect: 'Who picks the object', values: ['The client, from outside', 'The state objects themselves, as transitions'] },
      { aspect: 'Do the variants know each other', values: ['No, they are independent', 'Yes, a state knows which state comes next'] },
      { aspect: 'Question it answers', values: ['How should this job be done?', 'What can this object do right now?'] },
      { aspect: 'Typical examples', values: ['Discount rules, sorting, compression', 'Order status, document workflow, connection lifecycle'] },
    ],
    rule: 'If the caller chooses, it is Strategy. If the object moves itself between modes, it is State.',
  },
  {
    title: 'Factory Method vs Abstract Factory vs Builder',
    blurb: 'All three hide creation. They answer different questions about what is being created.',
    patterns: ['factory-method', 'abstract-factory', 'builder'],
    rows: [
      { aspect: 'What it creates', values: ['One product, chosen by a subclass', 'A family of related products', 'One complex product, step by step'] },
      { aspect: 'Mechanism', values: ['Inheritance: override a method', 'Composition: pass in a factory object', 'A builder object with named steps'] },
      { aspect: 'Focus', values: ['Which class to instantiate', 'Keeping products consistent with each other', 'How to assemble the parts'] },
      { aspect: 'Typical examples', values: ['Logistics creates Truck or Ship', 'Light or Dark UI widget sets', 'Pizza, HTTP request, query'] },
    ],
    rule: 'One thing, different type? Factory Method. Several matching things? Abstract Factory. One thing with many parts? Builder.',
  },
  {
    title: 'Observer vs Mediator',
    blurb: 'Both reduce direct coupling between objects. One broadcasts, the other coordinates.',
    patterns: ['observer', 'mediator'],
    rows: [
      { aspect: 'Communication shape', values: ['One-to-many broadcast', 'Many-to-many through a hub'] },
      { aspect: 'Who holds the logic', values: ['Each observer decides what to do', 'The mediator decides who gets what'] },
      { aspect: 'Knows its audience', values: ['Subject knows only a list of observers', 'Mediator knows all colleagues'] },
      { aspect: 'Risk', values: ['Update storms and forgotten unsubscribes', 'Mediator turns into a god object'] },
    ],
    rule: 'Announcing a change to whoever cares? Observer. Coordinating a conversation with rules? Mediator.',
  },
  {
    title: 'Command vs Memento (for undo)',
    blurb: 'Both can power undo. They remember different things.',
    patterns: ['command', 'memento'],
    rows: [
      { aspect: 'What is remembered', values: ['The action, plus how to reverse it', 'A snapshot of the state before'] },
      { aspect: 'How undo works', values: ['Call undo() on the command', 'Restore the saved state'] },
      { aspect: 'Memory cost', values: ['Small: just the command data', 'Larger: a copy of state per snapshot'] },
      { aspect: 'Bonus', values: ['Queue, log and replay actions', 'Restores even when actions are hard to reverse'] },
    ],
    rule: 'Actions are easy to reverse? Command. State is easier to save than to unpick? Memento. They combine well.',
  },
  {
    title: 'Decorator vs Composite',
    blurb: 'Both use recursive composition: an object that holds objects with the same interface.',
    patterns: ['decorator', 'composite'],
    rows: [
      { aspect: 'Holds', values: ['Exactly one inner object', 'Any number of children'] },
      { aspect: 'Purpose', values: ['Add responsibility to that one object', 'Aggregate results of the children'] },
      { aspect: 'Structure formed', values: ['A chain of layers', 'A tree'] },
      { aspect: 'Typical call', values: ['Do extra work, then delegate', 'Delegate to every child and combine'] },
    ],
    rule: 'One inner object that gains behaviour? Decorator. Many inner objects that form a part-whole tree? Composite.',
  },
  {
    title: 'Bridge vs Adapter vs Strategy',
    blurb: 'All three connect an abstraction to some other implementation. The timing and scope differ.',
    patterns: ['bridge', 'adapter', 'strategy'],
    rows: [
      { aspect: 'When it is applied', values: ['Designed up front', 'Added later, to retrofit', 'Designed up front'] },
      { aspect: 'What it separates', values: ['Two whole hierarchies that vary independently', 'Two existing, incompatible interfaces', 'One behaviour from its host class'] },
      { aspect: 'Goal', values: ['Avoid a class per combination', 'Make things fit without changing them', 'Swap an algorithm at runtime'] },
    ],
    rule: 'Planning two dimensions of variation? Bridge. Fixing a mismatch? Adapter. Swapping one algorithm? Strategy.',
  },
  {
    title: 'Template Method vs Strategy',
    blurb: 'Both let you vary part of an algorithm. One uses inheritance, the other composition.',
    patterns: ['template-method', 'strategy'],
    rows: [
      { aspect: 'Mechanism', values: ['Inheritance: subclasses override steps', 'Composition: hand in an object'] },
      { aspect: 'What varies', values: ['Some steps inside a fixed skeleton', 'The whole algorithm'] },
      { aspect: 'When it is chosen', values: ['At compile time, by the subclass', 'At runtime, by the caller'] },
      { aspect: 'Flexibility', values: ['Less: tied to the base class', 'More: swap anytime'] },
    ],
    rule: 'Fixed order with a few holes? Template Method. Swappable whole algorithm? Strategy.',
  },
  {
    title: 'Chain of Responsibility vs Decorator',
    blurb: 'Both link objects into a line that a call travels along.',
    patterns: ['chain-of-responsibility', 'decorator'],
    rows: [
      { aspect: 'What happens along the line', values: ['One handler usually takes it and the call stops', 'Every layer takes part, then delegates'] },
      { aspect: 'Can a link stop the flow', values: ['Yes, that is the point', 'Rarely'] },
      { aspect: 'Result', values: ['The handler\'s answer', 'The combined effect of all layers'] },
    ],
    rule: 'First capable one wins? Chain of Responsibility. Everyone contributes? Decorator.',
  },
];
