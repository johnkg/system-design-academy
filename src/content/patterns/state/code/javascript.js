// State in JavaScript. Each state class decides what each action does.

class Draft { // Concrete State
  edit(doc) { return "Editing the draft"; }
  publish(doc) { doc.setState(new Review()); return "Sent to review"; }
  reject(doc) { return "A draft has nothing to reject"; }
}

class Review { // Concrete State
  edit(doc) { return "Cannot edit while in review"; }
  publish(doc) { doc.setState(new Published()); return "Approved and published"; }
  reject(doc) { doc.setState(new Draft()); return "Sent back to draft"; }
}

class Published { // Concrete State
  edit(doc) { return "Cannot edit a published document"; }
  publish(doc) { return "Already published"; }
  reject(doc) { doc.setState(new Draft()); return "Unpublished: back to draft"; }
}

class Document { // Context: delegates everything to the current state
  #state = new Draft();
  setState(state) { this.#state = state; }
  get stateName() { return this.#state.constructor.name; }
  edit() { return this.#state.edit(this); }
  publish() { return this.#state.publish(this); }
  reject() { return this.#state.reject(this); }
}

const doc = new Document();
console.log(doc.stateName, "->", doc.edit());     // Draft -> Editing the draft
console.log(doc.publish(), "|", doc.stateName);   // Sent to review | Review
console.log(doc.edit());                          // Cannot edit while in review
console.log(doc.publish(), "|", doc.stateName);   // Approved and published | Published
console.log(doc.reject(), "|", doc.stateName);    // Unpublished: back to draft | Draft
