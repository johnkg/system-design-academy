# Ordering and de-duplicating chat messages in Python:
# the server numbers messages per conversation, ignores repeated client ids, and lets a client catch up after a sequence number.


class ConversationStore:
    def __init__(self):
        self._conversations = {}  # conversation id -> {"messages": [...], "by_client_id": {...}}

    def _get(self, id):
        if id not in self._conversations:
            self._conversations[id] = {"messages": [], "by_client_id": {}}
        return self._conversations[id]

    # Store a message once. A repeated client id (a retry) returns the original sequence number.
    def append(self, conversation_id, sender, client_id, text):
        conversation = self._get(conversation_id)
        key = f"{sender}:{client_id}"
        if key in conversation["by_client_id"]:
            return {"seq": conversation["by_client_id"][key], "duplicate": True}
        seq = len(conversation["messages"]) + 1  # the server decides the order, not the phone's clock
        conversation["messages"].append({"seq": seq, "sender": sender, "client_id": client_id, "text": text})
        conversation["by_client_id"][key] = seq
        return {"seq": seq, "duplicate": False}

    # Everything after a sequence number: how a reconnecting or offline client catches up
    def since(self, conversation_id, after_seq):
        return [m for m in self._get(conversation_id)["messages"] if m["seq"] > after_seq]


def show(result):
    return f"{{ seq: {result['seq']}, duplicate: {str(result['duplicate']).lower()} }}"


store = ConversationStore()
chat = "alice+bob"

print("alice sends 'hi':        ", show(store.append(chat, "alice", "m-901", "hi")))
# The acknowledgement was lost, so Alice's app sends the same message again with the same client id
print("alice retries 'hi':      ", show(store.append(chat, "alice", "m-901", "hi")))
print("bob replies:             ", show(store.append(chat, "bob", "m-14", "hello!")))
print("alice sends 'lunch?':    ", show(store.append(chat, "alice", "m-902", "lunch?")))

# Bob was offline after message 1 and now reconnects, asking for everything after seq 1
print("bob catches up after 1:  ", " | ".join(f"{m['seq']}:{m['sender']}:{m['text']}" for m in store.since(chat, 1)))
