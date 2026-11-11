"""Real cost of everything this project generated, read back from Kie (creditsConsumed). 1 credit = $0.005.
  python scripts/cost_report.py <project>
"""
import collections, json, os, sys
import kie

root, P = kie.project(sys.argv[1])
log = os.path.join(root, "tasks.log")
if not os.path.exists(log): raise SystemExit("No tasks logged yet.")
rows = [json.loads(l) for l in open(log, encoding="utf-8") if l.strip()]
by = collections.defaultdict(float); unknown = 0
for r in rows:
    if r["kind"] == "suno": unknown += 1; continue   # Suno uses a different endpoint; ~$0.10 or less per song
    try:
        d = kie.record(r["task"]); c = float(d.get("creditsConsumed") or 0)
        by[r["kind"]] += c
    except Exception:
        unknown += 1
total = sum(by.values())
print(f"{'model':<45} {'credits':>9} {'USD':>8}")
for k, c in sorted(by.items(), key=lambda x: -x[1]):
    print(f"{k:<45} {c:9.0f} {c*0.005:8.2f}")
print(f"{'TOTAL':<45} {total:9.0f} {total*0.005:8.2f}")
if unknown: print(f"({unknown} task(s) not priced here, e.g. Suno music, which is a few cents.)")
P["cost_usd"] = round(total * 0.005, 2); kie.save(root, P)
