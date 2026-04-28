# General rules

1. Understand project tech stack: @.agent/standards/tech-stack.md
2. Use project structure file for searching: @.agent/standards/project-structure.md
3. Follow project coding standards: @.agent/standards/code-style.md
4. Abide project best practices: @.agent/standards/best-practices.md

# Operating rules

1. Do only what you've been told.
2. Do not make things up.
3. Ask questions if you don't understand something.
4. Ask questions if you need more information.
5. Do not create additional files without asking.
6. **ALWAYS use GitNexus MCP FIRST when looking for code, symbols, references, call graphs, architecture, or impact.** This is mandatory, not optional.
7. **DO NOT use `bash`, `ls`, `find`, `grep`, `rg`, `cat`, or `Glob` to search code before exhausting GitNexus MCP tools** (`query`, `context`, `impact`, `cypher`, `detect_changes`, `rename`, resources under `gitnexus://repo/leo/...`).
8. Shell tools (`bash`, `ls`, `find`, `grep`) are allowed only for: (a) non-code files (configs, logs, build artifacts), (b) verifying a file path returned by GitNexus, (c) when GitNexus returns no results and you have explicitly stated so, or (d) git operations.
9. If GitNexus index is stale (mismatch vs `git rev-parse HEAD`), run `npx gitnexus analyze` before falling back to shell search.
