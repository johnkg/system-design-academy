// Without the pattern: the client loops over the playlist's internal array.

class Playlist {
  songs = ["Intro", "Verse", "Chorus"]; // exposed so callers can loop over it
}

const playlist = new Playlist();

for (let i = 0; i < playlist.songs.length; i++) console.log(playlist.songs[i]);

// Reverse needs different index math, copied into every place that wants it:
for (let i = playlist.songs.length - 1; i >= 0; i--) console.log(playlist.songs[i]);

// If Playlist switches to a linked list or a database cursor, every loop above breaks.
