# Without the pattern: every caller drives all four components.
from types import SimpleNamespace

lights = SimpleNamespace(dim=lambda l: print(f"Lights dimmed to {l}%"), on=lambda: print("Lights on"))
projector = SimpleNamespace(on=lambda: print("Projector on"), off=lambda: print("Projector off"))
amp = SimpleNamespace(set_volume=lambda v: print(f"Amplifier volume {v}"))
player = SimpleNamespace(play=lambda m: print(f'Playing "{m}"'), stop=lambda: print("Player stopped"))

# Screen A starts a movie...
lights.dim(10)
projector.on()
amp.set_volume(5)
player.play("Dune")

# ...and a voice command, a schedule and a remote app repeat this recipe.
# Forget projector.on() in one of them and you hear a movie with no picture.
