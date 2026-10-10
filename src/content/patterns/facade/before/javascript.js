// Without the pattern: every caller drives all four components.

const lights = { dim: (l) => console.log(`Lights dimmed to ${l}%`), on: () => console.log("Lights on") };
const projector = { on: () => console.log("Projector on"), off: () => console.log("Projector off") };
const amp = { setVolume: (v) => console.log(`Amplifier volume ${v}`) };
const player = { play: (m) => console.log(`Playing "${m}"`), stop: () => console.log("Player stopped") };

// Screen A starts a movie...
lights.dim(10);
projector.on();
amp.setVolume(5);
player.play("Dune");

// ...and a voice command, a schedule and a remote app repeat this recipe.
// Forget projector.on() in one of them and you hear a movie with no picture.
