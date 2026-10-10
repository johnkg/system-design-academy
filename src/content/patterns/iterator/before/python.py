# Without the pattern: the client loops over the playlist's internal list.

class Playlist:
    def __init__(self):
        self.songs = ["Intro", "Verse", "Chorus"]  # exposed so callers can loop over it


playlist = Playlist()

for i in range(len(playlist.songs)):
    print(playlist.songs[i])

# Reverse needs different index math, copied into every place that wants it:
for i in range(len(playlist.songs) - 1, -1, -1):
    print(playlist.songs[i])

# If Playlist switches to a linked list or a database cursor, every loop above breaks.
