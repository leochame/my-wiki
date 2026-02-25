## Tasks Overview

This file defines **how the task system works** and how the assistant should interact with it.  
It does **not** store any real task lists or views.

The underlying task system follows two core rules:
- **One task per file**: Each concrete task = one standalone `.md` file (stored in the `task/by-task/` subfolder).
- **YAML Front Matter as the database**: The YAML header of each task file (e.g. `due`, `status`, `priority`) is the only trusted source for the AI to query and update task state.

---

### Using the `today` command

When I send a message that is exactly **`today`** to my AI assistant, it should:

- Traverse all task `.md` files in the `task/by-task/` folder.
- Find tasks whose Front Matter has `status` not `done` and `due` equal to today.
- Optionally also surface tasks whose `status` is not `done` and whose `due` is earlier than today (overdue), and highlight soon-due high-priority tasks.

This behavior is implemented by the assistant based on the per-task YAML, **not** by anything in this file.

---

### Task file format (per-task `.md` with YAML Front Matter in `by-task/`)

Every concrete task with a deadline should have **its own file** in the `task/by-task/` folder, with YAML like:

---

### Folder layout

- `TASKS.md` — This file (concepts + how the system works).
- `TODO.md` — Non-deadline todo list.
- `by-task/` — All concrete per-task `.md` files, one file per task (IDs like `T-001`, `T-002`, ...).

```markdown
---
id: T-001
title: Draft article on LLM prompt patterns
status: todo            # todo | in-progress | waiting | done | cancelled
due: 2026-02-28
priority: high          # low | medium | high | urgent
---

## Description

Short description of the task and why it matters.

## Next Actions

- [ ] First concrete step
- [ ] Second concrete step
```

AI should:
- Treat each task file as **one record** in a task database.
- Update task state **only** by editing these YAML fields (e.g. changing `status` or `due`).
