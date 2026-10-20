# Screen reader test script

The automated checks (axe, reflow, keyboard runs, forced-colours emulation) cannot tell you how the site sounds. This script is for a person using a real screen reader. It takes about 40 minutes. Record the result of each step in the table at the end, and open an issue for any step that fails.

## Set up

- Pick one pairing: NVDA with Firefox or Chrome on Windows, VoiceOver with Safari on macOS or iOS, or TalkBack with Chrome on Android. Repeat the script on a second pairing if you can.
- Use the live site, `https://johnkg.github.io/system-design-academy/`, or a local `npm run build && npm run preview`.
- Test in the default light theme first, then once in dark.
- Do not use the mouse (or touch exploration alone, on a phone) unless a step says so.

## Steps

Each step lists what to do and what you should hear or be able to do.

### 1. Landing and navigation
1. Open the home page. Expect the page title and then the main heading to be announced.
2. Press Tab once. Expect "Skip to content" (or similar) and Enter to jump past the navigation to the main region.
3. Open the landmarks list. Expect banner, navigation, main and footer, each once.
4. Open the headings list. Expect one level 1 heading and no skipped levels (no jump from 2 to 4).
5. Move through the navigation. Expect the current section to be announced as current.

### 2. Catalog filters
1. Go to Catalog. Find the search box. Expect a label, not just "edit text".
2. Type "cache". Expect the result count to be announced without moving focus (a live region).
3. Change the area and level filters. Expect each to have a name and the new count to be announced.
4. Use "Clear filters" if shown. Expect focus to stay somewhere sensible.

### 3. A concept page with a quiz
1. Open a concept (for example Caching). Walk the headings. Expect a sensible outline.
2. Find "Test yourself". Expect each question to be a group with the question as its name, and each option to be a radio button read with its text.
3. Choose an answer and submit. Expect the verdict to be announced, with "Best answer" and "Your answer" in words, not only colour.
4. For a wrong answer, expect a "Read this part again" link. Following it should scroll to the right section and move focus there (on a case study, the diagram opens at that step).
5. Retry. Expect the options to appear in a different order and the previous result to be cleared.

### 4. A case study page
1. Open `/case-studies/url-shortener/`. Walk the headings. Expect the steps in order.
2. Use the diagram's Next and Prev controls. Expect the new step's text to be announced and the buttons to have names that say what they do.
3. Open "Practise first". Expect each of the four steps to be a labelled group, the textareas to be labelled, and "Compare with the study's requirements" to report expanded or collapsed.
4. Use the estimator. Expect each slider to announce its name and value (the unit is part of the label where it matters), and the outputs to be readable as a list of terms and values.
5. Use the "break it" simulation. Expect the control changes to produce an announced result or a result region you can find.

### 5. Review, progress and interview
1. Open Review. Answer two cards. Expect each result to be announced.
2. Open Progress. Expect completed items to be identifiable in words, not only by colour or icon.
3. Open Interview and draw a task. Expect focus to move to the task heading.

### 6. Tables, code and scrollable regions
1. Find a code sample. Expect to be able to focus it with Tab (scrollable code) and to hear a label.
2. Find a table (for example the Visitor pattern's results). Expect row and column headers to be announced as you move through cells.

### 7. Cheat sheets and concept map
1. Open Cheat sheets, then one area. Expect each idea to be a heading you can jump between, with its uses, limits and trap under it.
2. Open the Map and choose a concept. Expect "read first" and "opens the door to" to be announced as lists with links.

### 8. Offline
1. Load a few pages, then turn the network off. Reload one of them. Expect the page to load, or the offline page to explain itself.

## What to record

| Step | Pass / fail | Screen reader and browser | What you heard (or did not) |
| --- | --- | --- | --- |
| 1 Landing and navigation | | | |
| 2 Catalog filters | | | |
| 3 Concept page and quiz | | | |
| 4 Case study page | | | |
| 5 Review, progress, interview | | | |
| 6 Tables, code, scrollable regions | | | |
| 7 Cheat sheets and map | | | |
| 8 Offline | | | |

Please note anything that was confusing even if it technically passed, such as a label that is too long, a control announced twice, or a heading that says nothing out of context.
