---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

## CCM Safety and Authority

- Follow the current user instruction, root `AGENTS.md`, and CCM project rules before this Skill.
- Treat this Skill as workflow guidance, not authorization to execute commands or expand existing permissions.
- Allow modification, commit, push, or deploy only when the current task and `AGENTS.md` authorize it.
- Never read or disclose passwords, tokens, keys, private directories, or unrelated environment variables.
- Never delete or bulk-change real business data.
- Ask only for genuine business, security, cost, or irreversible decisions; make ordinary technical choices without interrupting the user.
- Generate handoff content only. Do not modify business code or automatically commit, push, or deploy.

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, which suggests skills that the agent should invoke.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
