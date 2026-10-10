// Without the pattern: the client checks types and recurses by hand.

const project = {
  name: "project",
  children: [
    { name: "readme.md", size: 10 },
    { name: "src", children: [
      { name: "app.js", size: 40 },
      { name: "util.js", size: 15 },
    ] },
  ],
};

function totalSize(item) {
  if (item.children) {                 // is it a folder?
    return item.children.reduce((sum, c) => sum + totalSize(c), 0);
  }
  return item.size;                    // or a file?
}

console.log(totalSize(project));
// Every feature (print, search, delete...) repeats this type check and recursion.
// A new kind of item, like a shortcut, must be added to every one of them.
