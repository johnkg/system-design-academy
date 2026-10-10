// Without the pattern: every method branches on a status string.

class Document {
  status = "draft";

  edit() {
    if (this.status === "draft") return "Editing the draft";
    else if (this.status === "review") return "Cannot edit while in review";
    else if (this.status === "published") return "Cannot edit a published document";
  }
  publish() {
    if (this.status === "draft") { this.status = "review"; return "Sent to review"; }
    else if (this.status === "review") { this.status = "published"; return "Approved and published"; }
    else if (this.status === "published") return "Already published";
  }
  reject() {
    if (this.status === "draft") return "A draft has nothing to reject";
    else { this.status = "draft"; return "Back to draft"; }
  }
  // Add an "archived" state: edit every method above, and hope you do not miss one.
}

const doc = new Document();
console.log(doc.edit(), "|", doc.publish(), "|", doc.status);
