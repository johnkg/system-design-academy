# Adaptive bitrate selection in Python:
# the player picks a quality for each video segment from the measured network speed and the amount of video buffered.

LADDER = [
    {"name": "240p", "mbps": 0.4},
    {"name": "480p", "mbps": 1.0},
    {"name": "720p", "mbps": 2.5},
    {"name": "1080p", "mbps": 5.0},
]
SEGMENT_SECONDS = 4
SAFETY = 0.8  # only use 80% of the measured speed, to leave room for variation
LOW_BUFFER = 4  # below this many seconds of buffered video, take the safest quality


# Choose the best quality that fits the estimated speed. With little buffered video, take no risks.
def choose_quality(estimated_mbps, buffer_seconds):
    if buffer_seconds < LOW_BUFFER:
        return LADDER[0]
    best = LADDER[0]
    for rendition in LADDER:
        if rendition["mbps"] <= estimated_mbps * SAFETY:
            best = rendition
    return best


# The speed the network really delivers for each segment (Mbps). The player cannot see these ahead of time.
network = [8.0, 8.0, 6.0, 3.0, 1.2, 0.8, 2.0, 4.0, 7.0, 9.0]

buffer = SEGMENT_SECONDS  # the first segment is already buffered when playback starts
estimate = 8.0  # measured speed of the previous segment
stalled_seconds = 0

for i, speed in enumerate(network):
    rendition = choose_quality(estimate, buffer)
    download_seconds = (rendition["mbps"] * SEGMENT_SECONDS) / speed
    # While downloading, playback uses up the buffer. If it runs out first, the video freezes.
    if download_seconds > buffer:
        stalled_seconds += download_seconds - buffer
    buffer = max(0, buffer - download_seconds) + SEGMENT_SECONDS
    estimate = speed  # the next choice uses what this download measured
    print(f"segment {i + 1:>2}  network {speed:.1f} Mbps  -> {rendition['name']:<5}  download {download_seconds:.1f} s  buffer {buffer:.1f} s")

print(f"stalled for {stalled_seconds:.1f} s in total")
