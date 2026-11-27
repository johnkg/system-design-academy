// Without the pattern: the whole payload travels inside the queue message.

const QUEUE_LIMIT_KB = 256;

function send(message) {
  if (message.sizeKb > QUEUE_LIMIT_KB) throw new Error("message too large");
  return "sent";
}

const video = { name: "holiday.mp4", sizeKb: 20000 };
console.log(`Message size: ${video.sizeKb} KB, queue limit: ${QUEUE_LIMIT_KB} KB`);
try {
  send(video);
} catch (error) {
  console.log(`Rejected: ${error.message}`);
}
// Even where a queue allows it, every hop and every consumer copies all 20000 KB.
