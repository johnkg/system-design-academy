# Walkthrough baseline: hand check

`scripts/walkthrough-baseline.json` lists numbers in "how to try it" steps that `npm run check:walkthroughs` cannot reproduce on its own. It is empty: the check reproduces every number every step quotes, and `BASELINE_CAP` in `scripts/baseline-cap.mjs` is 0.

## How the last 86 numbers were cleared

An earlier hand check replayed each of the 86 numbers in a browser and sorted them into five groups. None contradicted its simulation; each group was then cleared in its own way.

- **Shown exactly when the step is replayed (39)** and **an input the step types in (part of 11)**: the check now reads each step as an ordered script (press Reset, set controls in the order the text gives, type into text boxes, press the buttons named, with a look at the numbers after each action), so it reproduces these itself.
- **Shown rounded (12)**, **shown in another unit or format (11)**, **arithmetic on shown values (13)**: the steps were reworded to quote the figure the page displays (68.6 rather than 69, 1,819 ms rather than 1.8 s), or to state the comparison in words.
- **A parameter inside the model, never displayed (rest of the 11)**: the steps no longer quote it as a number.

## Keeping it empty

A step that quotes a number the simulation never shows fails the check. Fix the step: quote the figure as displayed, in the displayed unit, at settings the step names in order. Add a number to the baseline only as a last resort, after replaying the step by hand in a browser, and raise `BASELINE_CAP` in the same change so a reviewer sees both. `node scripts/check-walkthroughs.mjs --only <page> --scripts` prints the script each step is replayed as, which shows why a number was not reached.
