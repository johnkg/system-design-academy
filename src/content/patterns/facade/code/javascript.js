// Facade in JavaScript. HomeTheater hides the four-step recipe.

class Lights { // Subsystem
  dim(level) { console.log(`Lights dimmed to ${level}%`); }
  on() { console.log("Lights on"); }
}
class Projector { // Subsystem
  on() { console.log("Projector on"); }
  off() { console.log("Projector off"); }
}
class Amplifier { // Subsystem
  setVolume(level) { console.log(`Amplifier volume ${level}`); }
}
class Player { // Subsystem
  play(movie) { console.log(`Playing "${movie}"`); }
  stop() { console.log("Player stopped"); }
}

class HomeTheater { // Facade
  constructor(lights, projector, amp, player) {
    Object.assign(this, { lights, projector, amp, player });
  }

  watchMovie(movie) {
    this.lights.dim(10);       // the recipe, in the right order
    this.projector.on();
    this.amp.setVolume(5);
    this.player.play(movie);
  }

  endMovie() {
    this.player.stop();
    this.projector.off();
    this.lights.on();
  }
}

const theater = new HomeTheater(new Lights(), new Projector(), new Amplifier(), new Player());
theater.watchMovie("Dune"); // the client's whole job
theater.endMovie();
