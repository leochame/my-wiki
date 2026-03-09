## Overview

This workspace is for **tasks**, **writing**, and **reading notes**.  
All filenames and structure are in English.

## Collaboration Rules (root-level)

- **Plan briefly before big changes**: for multi-step tasks, write a short outline (goal + key steps) before editing many files.
- **No destructive actions without explicit permission**: never delete or overwrite important content unless the user specifies the exact path in this chat.
- **Keep responses structured**: use headings, bullet lists, and short summaries by default.

## Folder Map (top-level)

- **Tasks**: `task/`
  - Main file: `task/TASKS.md`
  - Non-deadline list: `task/TODO.md`
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
 - **Memory**: `Memory/`
   - Small, lightweight personal memories and snippets you want to keep.

## Lookup Strategy (on-demand, shallow)

- **Do not recursively scan subdirectories by default.**
- **Open index files first** (`TASKS.md`, `INDEX.md`) to locate relevant items.
- **Load the minimum needed files** (usually 1–3) to answer the current question.
- If a broader or recursive search seems useful, first ask the user to confirm the scope.
