# Checklists

Persistent, per-phase task checklist. This is the durable record — the
in-session task list is a working copy of it.

**Convention:** when a task's status changes, update its phase file as part of
the same change set, so a review of the working tree shows both the work and
the updated checklist together.

Phase scope and reasoning live in
[newsletter-agent-phased-build-plan.md](../newsletter-agent-phased-build-plan.md).
These files track execution, not design — if a task's shape changes, the plan
doc is what gets updated first.
