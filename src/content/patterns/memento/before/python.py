# Without the pattern: the save code reaches into the player's fields.

class Player:
    def __init__(self):
        self.hp = 100  # everything public so the saver can touch it
        self.level = 1


player = Player()
saves = []

saves.append({"hp": player.hp, "level": player.level})  # must know every field
player.hp -= 70
player.level += 1

last = saves.pop()
player.hp = last["hp"]  # and write each one back
player.level = last["level"]
print(f"Player {{ hp: {player.hp}, level: {player.level} }}")

# Add "inventory" to Player and forget to update the saver: saves silently lose it.
# Any code can also set player.hp = 9999 directly.
