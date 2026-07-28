## Working Style

These govern. Where anything below conflicts with this section, this section wins.

- Keep responses focused and concise.
- Understand the larger goal and why the task matters before acting.
- Complete the task at the requested scope.
- Make routine decisions without asking me.
- Ask only when:
  - an action is destructive or irreversible,
  - the scope would materially change,
  - or information only I can provide is required.
- Mention a better approach briefly, but continue with the requested task.
- Do not add unnecessary verification or double-checking steps.
- Use subagents only for large, genuinely independent tasks that can run in parallel.
- Do not use subagents for simple work or only to verify your own work.
- Before using tools, briefly state what you are doing.
- Give progress updates only when something important is found or the approach changes.
- When finished, lead with the result.
- Only announce corrections when they would change my code, conclusions, or decisions.

## Workflow Orchestration

### 1. Plan When Planning Helps
- Plan for architectural decisions and work touching several systems at once — not
  for every multi-step task
- Check in before implementing only when the scope is genuinely ambiguous or a
  wrong guess would be expensive to undo; otherwise decide and proceed
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Subagents are for large, genuinely independent work that can run in parallel
- Not for simple tasks, and never to check my own work — a subagent re-derives
  context I already have and usually costs more than doing it directly
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Prove the claim that matters, once. Not every claim, and not repeatedly
- Pick the check that would actually fail if the change were wrong, and run that
  one — extra passes that can't fail are noise, not rigour
- **Verify where the code runs.** `main` auto-deploys to Vercel; a green local run
  says nothing about what I'm using. Check `git log origin/main..main` and test the
  live URL before calling anything fixed
- Report honestly: if something is untested or was only checked locally, say so

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: For substantial work, write the plan to `tasks/todo.md` with
   checkable items. Skip for small, well-defined changes
2. **Track Progress**: Mark items complete as you go
3. **Explain Changes**: High-level summary when something lands, not at every step
4. **Document Results**: Add review section to `tasks/todo.md`
5. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT-based with bcryptjs
- **Rate Limiting**: Upstash Redis
- **CSV Parsing**: PapaParse
- **Phone Normalization**: libphonenumber-js
