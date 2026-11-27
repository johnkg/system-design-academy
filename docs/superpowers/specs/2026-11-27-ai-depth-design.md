# AI depth: how models work, and building with them

## Intent
The `aiml` area teaches how AI systems are served, fed with context, evaluated and kept safe. It does not teach how the models themselves work, and it has no pages on agents, fine-tuning, structured output or vector index internals. Add both: a theory area for learners who want to understand the machine, and practice pages for those who build with it.

## Goals
- A new area, "How AI models work" (`aifoundations`), with 8 theory concepts.
- 6 more practice concepts in `aiml`.
- 2 case studies for real gaps: a fine-tuning pipeline, and a code-assistant backend.
- 2 learning paths: "How LLMs work" and "Building with LLMs".
- Concept pages can show a Sources list (as company-named case studies already do), and each new page cites primary sources.
- Same teaching format as every other concept: problem, how it works, animation, simulation, trade-offs, quiz, and code in three languages where code helps.

## Non-goals
- No copies of what exists: 9 AI case studies (RAG platform, vector database, LLM gateway, evaluation platform, model registry, feature store, GPU scheduler, agent platform, recommender) and 8 `aiml` concepts are linked, not repeated.
- No `factChecked` date on new pages until an independent review.
- No claims about named commercial models' internals, prices or benchmark numbers. Models are described by their published designs, and numbers are derived in the page's own simulation from stated assumptions.

## Constraints
- `area` is an enum in `src/content.config.ts` and a list in `src/data/areas.ts`.
- Concept samples must print identical output in JS, Python and C# (`check:samples`). Floats are printed rounded.
- Accuracy is the main risk: every historical or numeric claim is checked against its primary source before it is written, and cited.
- House style: no dashes in content; plain English; each number a learner sees is shown by the simulation.

## Approaches
- A. Everything in `aiml` (about 22 concepts): simplest, but theory and systems pages read differently and the area gets long.
- B. New theory area plus extend `aiml` (chosen): theory gets its own cheat sheet and beginner path.
- C. Theory as a learning path only: no home for the pages.

## Design (B)
- Plumbing first: `aifoundations` area (blurb: how a language model turns text into numbers, learns from data and produces text); optional `sources` on concepts (title, publisher, year, https url), rendered as a Sources section and validated by `check:content`.
- Theory (aifoundations, 8): tokens-and-tokenization, attention-and-transformers, how-models-are-trained, sampling-temperature-and-decoding, context-windows-and-long-context, scaling-laws-and-model-size, quantization-and-model-compression, hallucination-and-grounding.
- Practice (aiml, 6): prompting-vs-fine-tuning-vs-rag, fine-tuning-and-lora, structured-output-and-function-calling, agents-and-tool-use, vector-index-internals, training-serving-skew.
- Case studies (2): model-fine-tuning-pipeline, code-assistant-backend.
- Paths (2): how-llms-work, building-with-llms.
- Batches, one commit each, branch `claude/ai-depth`: plumbing and theory; practice; case studies; wrap-up and full CI.

## Left to the builder
Scenarios, simulation controls and defaults, quiz wording, difficulty levels, diagram and animation layout, which concepts get code samples.
