# Facade in Python. HomeTheater hides the four-step recipe.


class Lights:  # Subsystem
    def dim(self, level):
        print(f"Lights dimmed to {level}%")

    def on(self):
        print("Lights on")


class Projector:  # Subsystem
    def on(self):
        print("Projector on")

    def off(self):
        print("Projector off")


class Amplifier:  # Subsystem
    def set_volume(self, level):
        print(f"Amplifier volume {level}")


class Player:  # Subsystem
    def play(self, movie):
        print(f'Playing "{movie}"')

    def stop(self):
        print("Player stopped")


class HomeTheater:  # Facade
    def __init__(self, lights, projector, amp, player):
        self.lights = lights
        self.projector = projector
        self.amp = amp
        self.player = player

    def watch_movie(self, movie):
        self.lights.dim(10)  # the recipe, in the right order
        self.projector.on()
        self.amp.set_volume(5)
        self.player.play(movie)

    def end_movie(self):
        self.player.stop()
        self.projector.off()
        self.lights.on()


theater = HomeTheater(Lights(), Projector(), Amplifier(), Player())
theater.watch_movie("Dune")  # the client's whole job
theater.end_movie()
