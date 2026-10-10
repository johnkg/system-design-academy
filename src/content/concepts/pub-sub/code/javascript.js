// Pub/sub in JavaScript: a topic with consumer groups. Each group gets every message; inside a group
// the message goes to just one member (the members share the work).

class Topic {
  #groups = new Map(); // group name -> { members: [{ name, handler }], next }

  subscribe(group, name, handler) {
    if (!this.#groups.has(group)) this.#groups.set(group, { members: [], next: 0 });
    this.#groups.get(group).members.push({ name, handler });
  }

  publish(message) { // the publisher neither knows nor waits for the subscribers
    for (const [group, g] of this.#groups) {
      const member = g.members[g.next++ % g.members.length]; // round robin inside the group
      member.handler(message, `${group}/${member.name}`);
    }
  }
}

const topic = new Topic();
const handle = (message, who) => console.log(`[${who}] handled ${message}`);

topic.subscribe("email", "worker-1", handle);
topic.subscribe("inventory", "worker-1", handle);
topic.subscribe("inventory", "worker-2", handle); // a second instance shares the inventory group's work
topic.subscribe("analytics", "worker-1", handle);

["order-1", "order-2"].forEach((id) => topic.publish(id));

topic.subscribe("fraud-check", "worker-1", handle); // added later: the publisher is unchanged
topic.publish("order-3");
