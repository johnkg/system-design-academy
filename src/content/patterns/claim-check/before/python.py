# Without the pattern: the whole payload travels inside the queue message.

QUEUE_LIMIT_KB = 256


def send(message):
    if message["size_kb"] > QUEUE_LIMIT_KB:
        raise ValueError("message too large")
    return "sent"


video = {"name": "holiday.mp4", "size_kb": 20000}
print(f"Message size: {video['size_kb']} KB, queue limit: {QUEUE_LIMIT_KB} KB")
try:
    send(video)
except ValueError as error:
    print(f"Rejected: {error}")
# Even where a queue allows it, every hop and every consumer copies all 20000 KB.
