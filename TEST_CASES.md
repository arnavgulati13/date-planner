# Lab 8 test cases

Five cases: 2 typical, 1 edge, and the 2 failure scenarios from Lab 7. Cases 1–4 test the real AI and can run automatically. Case 5 tests the booking guardrails, which are simulated, so you check it by hand in the app.

| # | Type | Input | What a good output looks like | Why this case matters |
|---|---|---|---|---|
| 1 | Typical | Demo couple (Maya & Sam). Plan: next Sat, 7:30 PM, Wicker Park, $$, cozy, vegetarian. | Exactly 3 picks: 2 Best fit + 1 Wildcard. All $$, open at 7:30, serve vegetarian food. Each Best fit's reason cites their history (The Violet Hour, Lula Cafe, "dim, talkable rooms"). No loud, high-energy rooms (their **Avoid** list). The Wildcard is called a stretch, has a caveat, and a lower % than both Best fits. No dishes or details that aren't in the venue data. | The core job: picks that fit both people and show the app remembered them. |
| 2 | Typical | Fresh couple. Both ♥ Kumiko, The Violet Hour, Avec. Both ✕ Au Cheval, Bavette's. Every other spot (including Big Star and Mi Tocaya): Maya ♥, Sam ✕. | The first profile puts cocktail bars and Mediterranean small plates under **Shared loves**, citing those venues. **Where they differ** names Maya's Mexican / taco picks. Diners and steakhouses are not shared loves. No neighborhood is recorded as a taste. Nothing invented beyond the ratings. | Onboarding is the cold start. A wrong first profile makes every later pick wrong. |
| 3 | Edge | Demo couple. Next Sun, 9:00 PM, River North, **$ only**, adventurous, vegetarian. Then **Generate more** with the note *"idk somewhere not too loud?? sam hates crowds lol"*. | Every pick still obeys the hard rules ($, open at 9 PM, vegetarian). If few venues pass, the app widens the search or shows fewer than 3; it never breaks a rule. Generate more shows **no repeats**. The new reasons respond to the note (quieter rooms, or a crowd caveat). | Real requests are messy and over-constrained. Does the model follow free text without breaking the rules? |
| 4 | Failure (Lab 7 #1) | Demo couple. Book a pick, then **Maya: Yes, Sam: No (Too loud)**. Plan another cozy date. Then book again and **Skip review**. | The review is saved as a **split**, not a joint yes, with Sam's reason. The profile records the split under **Where they differ**, **Watch**, **Avoid** or **Recent dates**, never as a **Shared love**. The next picks steer away from loud rooms. The skip is saved as **missing**: no profile update, profile unchanged. | The silent failure: wrong labels quietly corrupt every future pick. |
| 5 | Failure (Lab 7 #2) | Test mode → **Approved table is gone** → Allow. Then **Booking confirmation is wrong** → Allow. | **Slot gone:** the agent stops: *"Your 7:30 PM table is gone. Closest is 8:15 PM. Nothing has been booked."* Only the Time row is highlighted. Nothing is booked until you click **Approve 8:15 PM** (logged as a new approval). **Wrong confirmation:** the Approved vs. Confirmed check marks Party size 2 → 3 in red, and Book fails goes up by 1. | A wrong booking costs money and trust, and it only surfaces at the restaurant. |

## How to run them

### Option A: automatically (cases 1–4, about 90 seconds, a few cents)

With your `.env` set up (see the README), run this in the Terminal from the project folder:

```bash
.venv/bin/python -m scripts.run_test_cases
```

Each check prints as:

- **PASS / FAIL**: checked automatically (counts, budget, labels, what was saved).
- **LOOK**: needs a person. The quality of a reason ("does this actually avoid loud rooms?") can't be checked by code.

A full report, with every pick, reason and profile, is saved to `logs/test_runs/`. Read the LOOK items there. The runner uses its own scratch data folder, so your real couple in `data/` is never touched.

Useful options:

```bash
.venv/bin/python -m scripts.run_test_cases --case 1 --case 3
```

```bash
.venv/bin/python -m scripts.run_test_cases --model claude-sonnet-5-5
```

`--model` runs the same cases on another model without editing `config.json`. Run Haiku and Sonnet, then compare the two reports side by side. That's the "look for better options" exercise for class.

### Option B: by hand in the app (all five cases)

Start the app (`.venv/bin/python server.py`, then open http://localhost:8000). The right-hand log shows every AI call and click as you go, and `logs/ai_log.jsonl` keeps them.

- **Case 1:** In Test mode, click **Demo couple with 5 past dates**. Fill in the plan as in the table → **Find dates**. Read the three cards, and open "Picked by Claude…" above them to see the searches.
- **Case 2:** In Test mode, click **Happy path**. Rate the 14 spots as in the table → **Continue**. Read the "What we know so far" box, then open `data/profile.md` for the full profile. *This replaces the couple in `data/`.*
- **Case 3:** Load the demo couple, fill in the plan as in the table → **Find dates**. Then type the note into "None of these?" → **Generate more**.
- **Case 4:** Load the demo couple, plan any date, choose a pick → **Allow** → **Fast-forward: after the date**. Answer Maya **Yes**, Sam **No → Too loud** → **Save**. Read "Your updated profile", then plan a cozy date and read the reasons. For the skip, book again → Fast-forward → **Skip review**, and check that `data/profile.md` didn't change.
- **Case 5:** In Test mode, click **2 · Approved table is gone** → **Allow**, then try **Approve 8:15 PM**, **Back to other picks** and **Cancel**. Then click **2b · Booking confirmation is wrong** → **Allow** and read the booking check.

## First run (Claude Haiku 5.5, Nov 13)

22 of 22 automatic checks passed, with 4 left to read by hand (71 seconds). Things worth discussing in class:

- **Old praise and new complaints sit side by side.** In two runs out of two, case 4's lively pick was Avec, which the demo couple had loved on an earlier date. After Sam's "too loud", the profile kept Avec under **Shared loves** (the earlier date) and added it as evidence under **Avoid** (the new one). That's defensible, but it reads like a contradiction, and the next ranking has to resolve it.
- **The runner caught its own bug first.** Google's name for the venue ("avec Restaurant") didn't match the profile's ("Avec"), so the first version of a case 4 check failed even though the AI was right. Checks now match on the date. Reading a FAIL before blaming the model is part of testing.
- **The Wildcard's % is low (35%) next to the Best fits (65–70%).** That's honest, but it may stop couples choosing it.
- **Picks take about 17 seconds**, mostly the ranking step. Compare models and `effort` settings on it.
- **The "% you'd both go back" is the model's estimate**, not a measured probability. It stands in for the return model from Assignment 3.
