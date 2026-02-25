## Overview

This workspace is for **tasks**, **writing**, and **reading notes**.  
All filenames and structure are in English.

## Custom Commands

### /today
When I use the `/today` command, you should execute my custom daily summary script.  
Please follow these steps:
1. Run the command (using the repo-local virtualenv): `.venv/bin/python task/script/generate_today.py --date YYYY-MM-DD`
2. Wait for the script to finish and ensure it completes successfully.
3. Read the generated `task/today.md` file in this workspace and provide a concise summary or prioritization of the tasks.


## Collaboration Rules (root-level)

- **Plan briefly before big changes**: for multi-step tasks, write a short outline (goal + key steps) before editing many files.
- **No destructive actions without explicit permission**: never delete or overwrite important content unless the user specifies the exact path in this chat.
- **Keep responses structured**: use headings, bullet lists, and short summaries by default.

## Folder Map (top-level)

- **Tasks**: `task/`
  - Main file: `task/TASKS.md`
  - Per-task notes: `task/by-task/*.md`
- **Writing (technical + life articles)**: `write/`
  - Index: `write/INDEX.md`
  - Technical: `write/pre-ai-tech/`, `write/ai-practice/`, `write/ai-theory/`, `write/ai-frontier-papers/`
  - Life articles: `write/life-article/in-progress/`, `write/life-article/completed/`
- **Worth reading (study list)**: `worth-read-article/`
  - Index: `worth-read-article/INDEX.md`
  - Category summaries: `worth-read-article/by-category/*.md`
- **Long-term context**: `LLM Context/`
  - Stable background about the user and collaboration rules.

## Lookup Strategy (on-demand, shallow)

- **Do not recursively scan subdirectories by default.**
- **Open index files first** (`TASKS.md`, `INDEX.md`) to locate relevant items.
- **Load the minimum needed files** (usually 1–3) to answer the current question.
- If a broader or recursive search seems useful, first ask the user to confirm the scope.
