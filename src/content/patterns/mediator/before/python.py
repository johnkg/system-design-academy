# Without the pattern: every user holds references to every other user.

class User:
    def __init__(self, name):
        self.name = name
        self.friends = []

    def send(self, message):
        for f in self.friends:
            f.receive(self.name, message)

    def receive(self, sender, message):
        print(f'{self.name} got "{message}" from {sender}')


ada, bob, cy = User("Ada"), User("Bob"), User("Cy")
ada.friends = [bob, cy]  # 3 users, 6 links to wire by hand
bob.friends = [ada, cy]
cy.friends = [ada, bob]

ada.send("Hi all")
# A 4th user means editing all three existing users. A "no swearing" rule means
# copying the check into every User. Muting someone means changing everyone's list.
