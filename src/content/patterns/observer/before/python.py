# Without the pattern: the channel is hard-wired to every recipient.

class EmailSender:
    def send(self, headline):
        print(f"Email to ada@example.com: {headline}")


class SmsSender:
    def send(self, headline):
        print(f"SMS to +1-555-0100: {headline}")


class NewsChannel:
    def __init__(self):
        self.email = EmailSender()  # concrete types baked in
        self.sms = SmsSender()

    def publish(self, headline):
        self.email.send(headline)
        self.sms.send(headline)
        # Want push notifications? Edit this class. Want to unsubscribe? You can't.


NewsChannel().publish("Pattern of the day: Observer")
