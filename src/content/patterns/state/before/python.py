# Without the pattern: every method branches on a status string.

class Document:
    def __init__(self):
        self.status = "draft"

    def edit(self):
        if self.status == "draft":
            return "Editing the draft"
        elif self.status == "review":
            return "Cannot edit while in review"
        elif self.status == "published":
            return "Cannot edit a published document"

    def publish(self):
        if self.status == "draft":
            self.status = "review"
            return "Sent to review"
        elif self.status == "review":
            self.status = "published"
            return "Approved and published"
        elif self.status == "published":
            return "Already published"

    def reject(self):
        if self.status == "draft":
            return "A draft has nothing to reject"
        else:
            self.status = "draft"
            return "Back to draft"

    # Add an "archived" state: edit every method above, and hope you do not miss one.


doc = Document()
# Arguments are evaluated left to right, as in the JS version.
print(doc.edit(), "|", doc.publish(), "|", doc.status)
