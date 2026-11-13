// ============================================================================
// SIMULATED AI RESPONSES — the only file you need to edit to change AI output.
//
// Everything the "AI" says or decides in the prototype comes from this object.
// It is plain JSON assigned to a variable (so index.html opens by double-click,
// with no server needed). To swap in real AI later, replace the functions in
// app.js marked "AI CALL" with real model/agent calls that return the same shape.
//
// Template tokens: {loved} = name of an onboarding spot the couple liked,
//                  {a} / {b} = partner names, {venue} = selected venue name.
// ============================================================================
window.SIMULATED_RESPONSES = {
  "couple": { "a": "Maya", "b": "Sam" },

  // Step 1 — Onboarding: spots the couple already knows. Each partner rates each one.
  "onboardingVenues": [
    { "id": "kumiko",     "name": "Kumiko",          "type": "Cocktail bar",             "hood": "West Loop",    "emoji": "🍸" },
    { "id": "bigstar",    "name": "Big Star",        "type": "Tacos & whiskey",          "hood": "Wicker Park",  "emoji": "🌮" },
    { "id": "violethour", "name": "The Violet Hour", "type": "Speakeasy cocktail bar",   "hood": "Wicker Park",  "emoji": "🥃" },
    { "id": "monteverde", "name": "Monteverde",      "type": "Italian · handmade pasta", "hood": "West Loop",    "emoji": "🍝" },
    { "id": "girlgoat",   "name": "Girl & the Goat", "type": "Shared plates",            "hood": "West Loop",    "emoji": "🐐" },
    { "id": "aucheval",   "name": "Au Cheval",       "type": "Burgers · diner",          "hood": "West Loop",    "emoji": "🍔" },
    { "id": "avec",       "name": "Avec",            "type": "Mediterranean small plates","hood": "West Loop",   "emoji": "🫒" },
    { "id": "lostlake",   "name": "Lost Lake",       "type": "Tiki bar",                 "hood": "Logan Square", "emoji": "🍹" }
  ],

  // Step 2 — Planning: the constraint set that is always asked.
  "planOptions": {
    "times": ["6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM"],
    "locations": ["Fulton Market", "West Loop", "Wicker Park", "Logan Square", "River North"],
    "budgets": ["$", "$$", "$$$", "$$$$"],
    "vibes": ["cozy", "lively", "romantic", "adventurous"]
  },

  // Step 2→3 — The "AI is working" screen.
  "loadingSteps": ["Searches written", "40 spots found", "32 pass your rules", "Picking 3"],

  // Step 3 — Candidate venues the recommender ranks. (Fictional names; dummy distances.)
  // similarTo: onboarding ids this venue resembles — drives the "it remembered" reason.
  // slotOffsetMin: open slot relative to the requested time (0 = exact time free).
  // vegetarian: true | false | "limited" ("limited" shows a doubt flag on the card).
  "candidates": [
    { "id": "cellar9",  "name": "Cellar Nine",       "type": "Basement wine bar",              "price": "$$",  "rating": 4.6, "distance": "0.4 mi", "vibes": ["cozy", "romantic"],      "vegetarian": true,      "similarTo": ["violethour", "kumiko", "avec"], "base": 62, "slotOffsetMin": 0,
      "reason": "Dim and talkable — like {loved}, which you both loved.",              "reasonFallback": "Dim, quiet, and easy to talk in." },
    { "id": "fiore",    "name": "Trattoria Fiore",   "type": "Italian",                        "price": "$$$", "rating": 4.5, "distance": "0.6 mi", "vibes": ["romantic", "cozy"],      "vegetarian": true,      "similarTo": ["monteverde"],                   "base": 60, "slotOffsetMin": 0,
      "reason": "Similar to {loved}, but quieter, with plenty of fish and veg dishes.", "reasonFallback": "Quiet Italian with plenty of fish and veg dishes." },
    { "id": "piccolo",  "name": "Piccolo Piatti",    "type": "Small-plates wine bar",          "price": "$$",  "rating": 4.4, "distance": "0.3 mi", "vibes": ["cozy", "lively"],        "vegetarian": true,      "similarTo": ["avec", "girlgoat"],             "base": 58, "slotOffsetMin": 15,
      "reason": "New for you — shareable plates like {loved} keep it not-too-adventurous.", "reasonFallback": "New for you, with easy shareable plates." },
    { "id": "copper",   "name": "The Copper Room",   "type": "Cocktail bar + light dinner",    "price": "$$",  "rating": 4.3, "distance": "0.5 mi", "vibes": ["cozy", "lively"],        "vegetarian": true,      "similarTo": ["kumiko", "violethour", "lostlake"], "base": 56, "slotOffsetMin": 0,
      "reason": "You both rated {loved} highly — this is the most low-key option.",     "reasonFallback": "A low-key cocktail bar with a short dinner menu." },
    { "id": "seoul",    "name": "Seoul Smoke",       "type": "Korean BBQ",                     "price": "$$",  "rating": 4.8, "distance": "0.7 mi", "vibes": ["lively", "adventurous"], "vegetarian": "limited", "similarTo": ["girlgoat", "bigstar"],          "base": 54, "slotOffsetMin": 0,
      "reason": "Something new — grill-at-the-table energy, like {loved}.",             "reasonFallback": "Something new — grill-at-the-table energy.",
      "flag": "Check the menu for vegetarian options" },
    { "id": "halftime", "name": "Halftime Tavern",   "type": "Sports tavern",                  "price": "$$",  "rating": 4.4, "distance": "0.2 mi", "vibes": ["lively"],                "vegetarian": true,      "similarTo": ["aucheval", "bigstar"],          "base": 48, "slotOffsetMin": 0,
      "reason": "Great burgers, like {loved}. Big screens, so it can get loud.",        "reasonFallback": "Great burgers and big screens." },
    { "id": "lantern",  "name": "Lantern & Vine",    "type": "Rooftop terrace",                "price": "$$$", "rating": 4.5, "distance": "0.9 mi", "vibes": ["romantic", "lively"],    "vegetarian": true,      "similarTo": ["girlgoat"],                     "base": 52, "slotOffsetMin": 30,
      "reason": "Skyline views with a menu in the spirit of {loved}.",                  "reasonFallback": "Skyline views and a seasonal menu." },
    { "id": "marisol",  "name": "Marisol",           "type": "Mexican seafood",                "price": "$$",  "rating": 4.4, "distance": "0.8 mi", "vibes": ["lively", "adventurous"], "vegetarian": true,      "similarTo": ["bigstar"],                      "base": 50, "slotOffsetMin": 0,
      "reason": "A step up from {loved} — bright, fun, and great for sharing.",         "reasonFallback": "Bright, fun, and great for sharing." },
    { "id": "nonna",    "name": "Casa Nonna",        "type": "Neighborhood trattoria",         "price": "$",   "rating": 4.2, "distance": "1.1 mi", "vibes": ["cozy"],                  "vegetarian": true,      "similarTo": ["monteverde"],                   "base": 46, "slotOffsetMin": -30,
      "reason": "A cheaper, cozier cousin of {loved}.",                                 "reasonFallback": "Cheap, cozy, red-sauce comfort." },
    { "id": "obsidian", "name": "Obsidian",          "type": "Tasting-menu counter",           "price": "$$$$","rating": 4.9, "distance": "0.5 mi", "vibes": ["romantic", "adventurous"],"vegetarian": true,     "similarTo": ["girlgoat", "avec"],             "base": 50, "slotOffsetMin": 60,
      "reason": "A special-occasion splurge for fans of {loved}.",                      "reasonFallback": "A special-occasion splurge." }
  ],

  // Scoring rules (simple conditional logic standing in for the return-probability model).
  "scoring": {
    "perVibeMatch": 10,
    "lovedByBoth": 12,
    "lovedByOne": 5,
    "dislikedByBoth": -15,
    "maxPercent": 92,
    "minPercent": 35
  },

  "recommendationsHeader": "Here are your picks for {date}",
  "noMoreMessage": "That's every spot that passes your rules. Try changing your plan.",

  // Step 4 — Booking agent (simulated; nothing real is booked).
  "booking": {
    "platform": "OpenTable (simulated)",
    "confirmPrompt": "I'll reserve {venue} on your behalf. Nothing is booked until you allow it.",
    "agentSteps": ["Opening booking platform", "Slot still open", "Reserving table", "Reading confirmation back"],
    "successMessage": "You're booked. Confirmation verified against what you approved.",
    "confirmationPrefix": "OT-",
    "deposit": "None"
  },

  // Step 5 — Post-visit review.
  "review": {
    "question": "Would you go back to {venue}?",
    "thanks": "Saved. Next time, we'll use this to pick better."
  },

  // ==========================================================================
  // FAILURE SCENARIOS — triggered from the Test mode panel.
  // ==========================================================================
  "failureScenarios": {

    // Scenario 1 — Recommender learns the wrong lesson (Step 5, verification).
    // Input: partners disagree (or skip). Output: a split / missing verdict, never a fake joint yes or no.
    "scenario1": {
      "input": { "a": "yes", "b": "no", "reasonB": "Too loud" },   // what "Jump to review" pre-fills
      "reasons": ["Too loud", "Food", "Price", "Vibe", "Service"],
      "verdictLabels": { "joint_yes": "Joint yes", "joint_no": "Joint no", "split": "Split verdict", "missing": "Missing" },
      "splitLine": "{yes} would go back to {venue}. {no} wouldn't — {reason}.",
      "noReasonText": "no reason given yet",
      "adjustments": {
        "Too loud": "Next time we'll favor quieter, talkable rooms for {who}.",
        "Food":     "Next time we'll weigh {who}'s food preferences more heavily.",
        "Price":    "Next time we'll keep picks at a lower price point for {who}.",
        "Vibe":     "Next time we'll steer away from this kind of vibe for {who}.",
        "Service":  "Next time we'll favor places with stronger service reviews for {who}.",
        "none":     "Next time we'll treat {venue} as a maybe, not a sure thing."
      },
      "jointYesLine": "You'd both go back. {venue} is a keeper.",
      "jointNoLine": "Neither of you would go back. We won't suggest places like {venue} again.",
      "missingLine": "Saved as missing — it won't count as a yes or a no, so it can't skew your next picks."
    },

    // Scenario 2 — Booking agent books the wrong thing (Step 4, verification).
    // Input: the approved slot is gone at booking time. Output: agent stops, shows old vs. new terms.
    "scenario2": {
      "nearMatchOffsetMin": 45,                 // approved 7:30 PM -> closest open 8:15 PM
      "nearMatchDeposit": "None",               // set e.g. "$25 per person" to also change the deposit
      "agentStepsSlotGone": ["Opening booking platform", "Checking your approved slot", "Slot no longer available — stopping"],
      "warning": "Your {old} table is gone. Closest is {new}. Nothing has been booked.",
      "agentStepsRebook": ["Opening booking platform", "Reserving the newly approved slot", "Reading confirmation back"],
      // "Confirmation comes back wrong" test switch: the platform returns this field changed.
      "wrongConfirmation": { "field": "partySize", "value": 3 },
      "mismatchWarning": "The confirmation doesn't match what you approved. Don't rely on this booking — it has been flagged for a fix or cancellation."
    }
  },

  // ==========================================================================
  // TEST MODE — pick a scenario; the app fills in earlier steps with sample data
  // and opens at the relevant stage.
  // ==========================================================================
  "testMode": {
    "scenarios": [
      { "id": "happy", "label": "Happy path", "startsAt": "Starts at Step 1 · Onboarding", "screen": "onboarding",
        "whatToDo": "Go through the normal journey: rate spots, plan, pick, allow, then review. With real AI on, onboarding starts a fresh couple profile." },
      { "id": "demo", "label": "Demo couple with 5 past dates", "startsAt": "Starts at Step 2 · Plan", "screen": "plan",
        "liveOnly": true,
        "whatToDo": "Loads Maya & Sam with five past dates and a written profile, so the real AI's picks can lean on their history. Plan a date and read why each pick fits." },
      { "id": "split", "label": "1 · Couple disagrees after the date", "startsAt": "Starts at Step 5 · Review", "screen": "review",
        "prefillReview": true, "local": true,
        "whatToDo": "Maya said Yes, Sam said No (too loud). See the Split verdict card. Change the reason or an answer, then Save — or click Skip review to see it saved as missing." },
      { "id": "slotGone", "label": "2 · Approved table is gone", "startsAt": "Starts at Step 4 · Approval", "screen": "confirm",
        "slotGone": true, "local": true,
        "whatToDo": "Click Allow. The agent will find your 7:30 PM slot gone and stop. Then approve 8:15 PM, go back to other picks, or cancel." },
      { "id": "wrongConfirm", "label": "2b · Booking confirmation is wrong", "startsAt": "Starts at Step 4 · Approval", "screen": "confirm",
        "wrongConfirmation": true, "local": true,
        "whatToDo": "Click Allow. The confirmation comes back for 3 people instead of 2 — the booking check marks it in red." }
    ],
    // Sample data used to fill in earlier steps when a scenario starts mid-journey.
    // Scenarios marked "local" always run on this simulated data, even with real AI on.
    "sampleSetup": {
      "lovedByA": ["violethour", "monteverde", "kumiko", "avec"],
      "lovedByB": ["violethour", "kumiko", "girlgoat"],
      "plan": { "time": "7:30 PM", "location": "Fulton Market", "budgets": ["$$", "$$$"], "vibes": ["cozy"], "vegetarian": true }
    }
  }
};
