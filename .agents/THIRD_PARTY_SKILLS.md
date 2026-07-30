# Third-Party Skills Provenance

- Source: https://github.com/mattpocock/skills
- Installer: `skills@1.5.19`
- Installed: 2026-07-30
- Verified upstream commit: `2ab958093e83e0ec752e6c1c5932da465bf23e0c`
- Verification: before CCM customization, every installed file under the five Skill directories matched the corresponding file at the verified commit after Git newline normalization.

## Installed Skills

- `handoff`
- `code-review`
- `tdd`
- `diagnosing-bugs`
- `resolving-merge-conflicts`

## CCM Local Modifications

The following upstream files contain CCM-specific safety and decision-threshold controls:

- `skills/handoff/SKILL.md`
- `skills/code-review/SKILL.md`
- `skills/tdd/SKILL.md`
- `skills/tdd/mocking.md`
- `skills/diagnosing-bugs/SKILL.md`
- `skills/diagnosing-bugs/scripts/hitl-loop.template.sh`
- `skills/resolving-merge-conflicts/SKILL.md`

The `agents/openai.yaml` files were reviewed and remain unchanged because they contain display metadata only and do not grant permissions or provide execution instructions. `skills-lock.json` remains installer-generated; its hashes must not be edited manually.

## Update Policy

- Root `AGENTS.md`, the current user instruction, and CCM project rules always take precedence over every third-party Skill.
- Do not run `skills update` automatically.
- Review every upstream update on a separate branch before adoption.
- Re-verify the upstream source and file hashes, reapply CCM controls deliberately, and complete a new security review before merging an update.
