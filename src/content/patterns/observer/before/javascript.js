// Without the pattern: the channel is hard-wired to every recipient.

class EmailSender {
  send(headline) { console.log(`Email to ada@example.com: ${headline}`); }
}
class SmsSender {
  send(headline) { console.log(`SMS to +1-555-0100: ${headline}`); }
}

class NewsChannel {
  constructor() {
    this.email = new EmailSender(); // concrete types baked in
    this.sms = new SmsSender();
  }

  publish(headline) {
    this.email.send(headline);
    this.sms.send(headline);
    // Want push notifications? Edit this class. Want to unsubscribe? You can't.
  }
}

new NewsChannel().publish("Pattern of the day: Observer");
