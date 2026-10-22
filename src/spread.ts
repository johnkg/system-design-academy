// Keeps the boxes of an animated diagram apart. Authors give each box a spot as a fraction of the stage;
// that spot works on a wide screen, but on a phone the same fractions put boxes on top of each other.
// This nudges boxes apart (and makes the stage taller when there is no room sideways) without changing their order.

export interface Wanted { fx: number; fy: number; w: number; h: number } // fractions (0 to 1) of the stage; size in px
export interface Placed { x: number; y: number } // centre of the box, in px
export interface Options {
  pad: number; // clear space kept between two boxes, px
  top: number; // clear space kept above the first row, px (room for an arrow that comes into a box from above)
  maxHeight: number; // the stage never grows beyond this, px
  together?: (i: number, j: number) => boolean; // false when two boxes are never on screen at once
}

const ROUNDS = 120; // relaxation passes tried per attempt
const ATTEMPTS = 12; // tries before giving up and keeping the best-effort layout
const FIRST_BIAS = 1.5; // a shove sideways is chosen only when it is under 1.5 times the shove up or down
const BIAS_STEP = 0.5; // each retry prefers moving boxes up and down a little more

// Boxes start at the author's spot for a stage of baseHeight and are pushed apart; the stage is as tall as the lowest box needs.
export function spread(items: Wanted[], width: number, baseHeight: number, o: Options): { pos: Placed[]; height: number } {
  const together = o.together ?? (() => true);
  let pos: Placed[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const bias = FIRST_BIAS + attempt * BIAS_STEP;
    pos = items.map((it) => ({ x: it.fx * width, y: it.fy * baseHeight }));
    const clamp = () => items.forEach((it, i) => {
      const halfW = it.w / 2;
      pos[i].x = Math.min(Math.max(pos[i].x, halfW), Math.max(halfW, width - halfW));
      pos[i].y = Math.min(Math.max(pos[i].y, it.h / 2 + o.top), o.maxHeight);
    });
    clamp();
    let settled = false;
    for (let round = 0; round < ROUNDS && !settled; round++) {
      settled = true;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (!together(i, j)) continue;
          const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
          const overX = (items[i].w + items[j].w) / 2 + o.pad - Math.abs(dx);
          const overY = (items[i].h + items[j].h) / 2 + o.pad - Math.abs(dy);
          if (overX <= 0 || overY <= 0) continue;
          settled = false;
          // Move along the axis that needs the smaller shove (each box takes half), unless there is no room left to move sideways.
          const sideways = overX / 2;
          const [left, right] = dx >= 0 ? [i, j] : [j, i];
          const roomSideways = pos[left].x - items[left].w / 2 >= sideways && width - (pos[right].x + items[right].w / 2) >= sideways;
          if (overY <= overX * bias || !roomSideways) {
            const s = (dy === 0 ? 1 : Math.sign(dy)) * overY / 2;
            pos[i].y -= s; pos[j].y += s;
          } else {
            const s = (dx === 0 ? 1 : Math.sign(dx)) * overX / 2;
            pos[i].x -= s; pos[j].x += s;
          }
        }
      }
      clamp();
    }
    if (settled) break;
  }
  const bottom = Math.max(0, ...items.map((it, i) => pos[i].y + it.h / 2));
  return { pos, height: Math.min(o.maxHeight, Math.max(baseHeight, Math.ceil(bottom + o.pad))) };
}
