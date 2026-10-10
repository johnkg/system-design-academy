// Observer in JavaScript. Any object with an update() method is an observer.

class NewsChannel { // Subject
  #subscribers = new Set();

  subscribe(observer) {
    this.#subscribers.add(observer);
    return () => this.#subscribers.delete(observer); // call to unsubscribe
  }

  publish(headline) {
    for (const observer of this.#subscribers) observer.update(headline);
  }
}

class EmailSubscriber { // Concrete Observer
  constructor(address) { this.address = address; }
  update(headline) { console.log(`Email to ${this.address}: ${headline}`); }
}

class SmsSubscriber { // Concrete Observer
  constructor(number) { this.number = number; }
  update(headline) { console.log(`SMS to ${this.number}: ${headline}`); }
}

const channel = new NewsChannel();
const unsubscribeEmail = channel.subscribe(new EmailSubscriber("ada@example.com"));
channel.subscribe(new SmsSubscriber("+1-555-0100"));

channel.publish("Pattern of the day: Observer"); // both are notified
unsubscribeEmail();
channel.publish("Second headline");              // only SMS is notified
