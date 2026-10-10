// Ordering and de-duplicating chat messages in JavaScript:
// the server numbers messages per conversation, ignores repeated client ids, and lets a client catch up after a sequence number.

class ConversationStore {
  #conversations = new Map(); // conversation id -> { messages, byClientId }

  #get(id) {
    if (!this.#conversations.has(id)) this.#conversations.set(id, { messages: [], byClientId: new Map() });
    return this.#conversations.get(id);
  }

  // Store a message once. A repeated client id (a retry) returns the original sequence number.
  append(conversationId, sender, clientId, text) {
    const conversation = this.#get(conversationId);
    const key = `${sender}:${clientId}`;
    if (conversation.byClientId.has(key)) return { seq: conversation.byClientId.get(key), duplicate: true };
    const seq = conversation.messages.length + 1; // the server decides the order, not the phone's clock
    conversation.messages.push({ seq, sender, clientId, text });
    conversation.byClientId.set(key, seq);
    return { seq, duplicate: false };
  }

  // Everything after a sequence number: how a reconnecting or offline client catches up
  since(conversationId, afterSeq) {
    return this.#get(conversationId).messages.filter((m) => m.seq > afterSeq);
  }
}

const store = new ConversationStore();
const chat = "alice+bob";

console.log("alice sends 'hi':        ", store.append(chat, "alice", "m-901", "hi"));
// The acknowledgement was lost, so Alice's app sends the same message again with the same client id
console.log("alice retries 'hi':      ", store.append(chat, "alice", "m-901", "hi"));
console.log("bob replies:             ", store.append(chat, "bob", "m-14", "hello!"));
console.log("alice sends 'lunch?':    ", store.append(chat, "alice", "m-902", "lunch?"));

// Bob was offline after message 1 and now reconnects, asking for everything after seq 1
console.log("bob catches up after 1:  ", store.since(chat, 1).map((m) => `${m.seq}:${m.sender}:${m.text}`).join(" | "));
