# CLAUDE.md

Go task by task. After each task, stop and let me review — **do not run `git commit`, `git add`, or any other git write command.** I manage git myself.

This is a project where I'm trying to learn more about agent development (including claude-agent-sdk and langgraph as libraries), so after each task completed it would be helpful for you to explain what was done and what code I should look at to flesh out my understanding.

## Checklists

`checklists/phase-N.md` is a **plan, not a log**. Each entry is a short list of discrete steps to be done, written in the same process-descriptive voice throughout.

Check items off as they complete. Only rewrite an entry afterwards if the work turned out significantly different from what was scoped — and then re-scope it in that same voice, rather than appending what happened. Findings, measurements, verification results, and the reasoning behind decisions do not go here. They belong in the walkthrough you write after each task, and in the plan document only when they change the architecture.

## Comments

Write comments for someone reading the file cold, who has never seen our conversation.

Comment on what the code cannot show for itself: a non-obvious constraint, an opaque bit of syntax, an invariant a future edit must not break. Leave out the decision history — alternatives we weighed and rejected, what a value used to be, why we switched approach. That reads as noise to anyone who wasn't in the discussion, and it ages badly.

The test: if a comment only makes sense to someone who followed our back-and-forth, cut it, or reduce it to the one fact that outlives the conversation.
