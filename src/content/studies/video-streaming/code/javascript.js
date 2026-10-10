// Adaptive bitrate selection in JavaScript:
// the player picks a quality for each video segment from the measured network speed and the amount of video buffered.

const LADDER = [
  { name: "240p", mbps: 0.4 },
  { name: "480p", mbps: 1.0 },
  { name: "720p", mbps: 2.5 },
  { name: "1080p", mbps: 5.0 },
];
const SEGMENT_SECONDS = 4;
const SAFETY = 0.8; // only use 80% of the measured speed, to leave room for variation
const LOW_BUFFER = 4; // below this many seconds of buffered video, take the safest quality

// Choose the best quality that fits the estimated speed. With little buffered video, take no risks.
function chooseQuality(estimatedMbps, bufferSeconds) {
  if (bufferSeconds < LOW_BUFFER) return LADDER[0];
  let best = LADDER[0];
  for (const rendition of LADDER) {
    if (rendition.mbps <= estimatedMbps * SAFETY) best = rendition;
  }
  return best;
}

// The speed the network really delivers for each segment (Mbps). The player cannot see these ahead of time.
const network = [8.0, 8.0, 6.0, 3.0, 1.2, 0.8, 2.0, 4.0, 7.0, 9.0];

let buffer = SEGMENT_SECONDS; // the first segment is already buffered when playback starts
let estimate = 8.0; // measured speed of the previous segment
let stalledSeconds = 0;

network.forEach((speed, i) => {
  const rendition = chooseQuality(estimate, buffer);
  const downloadSeconds = (rendition.mbps * SEGMENT_SECONDS) / speed;
  // While downloading, playback uses up the buffer. If it runs out first, the video freezes.
  if (downloadSeconds > buffer) stalledSeconds += downloadSeconds - buffer;
  buffer = Math.max(0, buffer - downloadSeconds) + SEGMENT_SECONDS;
  estimate = speed; // the next choice uses what this download measured
  console.log(`segment ${String(i + 1).padStart(2)}  network ${speed.toFixed(1)} Mbps  -> ${rendition.name.padEnd(5)}  download ${downloadSeconds.toFixed(1)} s  buffer ${buffer.toFixed(1)} s`);
});

console.log(`stalled for ${stalledSeconds.toFixed(1)} s in total`);
