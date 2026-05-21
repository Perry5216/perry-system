# Book-Planning Test Fixtures

Diverse premises designed to stress-test the Book Planning pipeline across
genres, structures, and scale.

| Fixture | Genre / shape | What it stress-tests |
|---|---|---|
| [`trace.json`](trace.json) | Single-POV procedural mystery | Foreshadowing & payoff with layered clues; restrained first-person voice |
| [`reykjavik.json`](reykjavik.json) | Dual-POV contemporary romance | Emotional throughline; tight 14-chapter structure; two distinguishable first-person voices |
| [`heist.json`](heist.json) | Ensemble thriller, structured plot | Tension Blueprint on a rigid 5-act structure; 3 POVs + 3 supporting characters |
| [`crown-of-ash.json`](crown-of-ash.json) | **Stress test** — 80 ch × 3000 wd, 6 POVs, Book 1 of 3 | Scale limits, multi-POV juggling, series-aware planning, faction scaling |

## Running fixtures

```powershell
# Run all four fixtures in sequence (creates projects, does NOT auto-execute)
.\run-fixtures.ps1

# Run a specific fixture
.\run-fixtures.ps1 -Fixture trace

# Create AND immediately kick off planning execution
.\run-fixtures.ps1 -Execute

# Watch project status as planning runs
.\run-fixtures.ps1 -Watch
```

The runner prints the project ID for each fixture so you can find them in the
dashboard at <http://localhost:3847>.

## Audit after running

Each fixture has a "Project Goals" section in its description that lists what
the run should be audited for. After all four complete, compare the
step-by-step outputs against those goals to find where the pipeline performs
well vs falls down.
