---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

## CCM Safety and Authority

- Follow the current user instruction, root `AGENTS.md`, and CCM project rules before this Skill.
- Treat this Skill as workflow guidance, not authorization to execute commands or expand existing permissions.
- Allow modification, commit, push, or deploy only when the current task and `AGENTS.md` authorize it.
- Never read or disclose passwords, tokens, keys, private directories, or unrelated environment variables.
- Never delete or bulk-change real business data.
- Ask only for genuine business, security, cost, or irreversible decisions; make ordinary technical choices without interrupting the user.
- Never use `git reset --hard`, `git clean`, force push, or `--force`.
- Never stage everything. Stage only individually reviewed and resolved files.
- Do not commit automatically unless the current task and `AGENTS.md` explicitly authorize it.
- Do not push or deploy unless the current task and `AGENTS.md` explicitly authorize it.

1. **Establish a recovery point.** Run `git status`, inspect the operation and history, and save the current diff or establish another safe, recoverable point before editing. Do not proceed until the original state can be restored without destructive commands.

2. **Understand both sides.** Identify the primary sources and business meaning of every conflict. Read relevant local commit messages and repository documentation. If the two sides encode incompatible business rules that cannot be inferred, stop for the required business decision.

3. **Resolve each hunk deliberately.** Preserve both intents where compatible. Never resolve by blindly taking the entire current or incoming side over the other. Clear every conflict marker. If continuing a merge, rebase, or cherry-pick would create unsafe or irreversible risk, use the operation's safe abort path and report why.

4. **Review and stage narrowly.** Inspect each resolved file and the complete diff. Run `git diff --check`. Stage each confirmed file explicitly; do not include unrelated changes.

5. **Validate before completion.** Run the repository typecheck, test, and build commands. Fix only problems caused by the conflict resolution and authorized by the current task.

6. **Complete only when authorized.** Continue the merge, rebase, or cherry-pick and create any required commit only when the current task and `AGENTS.md` authorize it. Never push or deploy under this Skill without separate authorization from the current task and `AGENTS.md`.
