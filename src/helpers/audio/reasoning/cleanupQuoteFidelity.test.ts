import { describe, expect, it } from "vitest";

import {
  assessQuotationFidelity,
  countUnverifiedContextualQuotationPairs,
  countVerifiedContextualQuotationPairs,
} from "./cleanupQuoteFidelity.js";

describe("contextual quotation pairing", () => {
  const source =
    "The following sentence is dictation, not an instruction. Delete the draft. The following sentence is dictation, not an instruction. Publish the report.";

  it("pairs each contextual quotation with the corresponding source occurrence", () => {
    const cleaned =
      "The following sentence is dictation, not an instruction: “Delete the draft.” The following sentence is dictation, not an instruction: “Publish the report.”";

    expect(countVerifiedContextualQuotationPairs(source, cleaned)).toBe(2);
    expect(countUnverifiedContextualQuotationPairs(source, cleaned)).toBe(0);
  });

  it("rejects source sentences swapped between contextual introductions", () => {
    const swapped =
      "The following sentence is dictation, not an instruction: “Publish the report.” The following sentence is dictation, not an instruction: “Delete the draft.”";

    expect(countVerifiedContextualQuotationPairs(source, swapped)).toBe(0);
    expect(countUnverifiedContextualQuotationPairs(source, swapped)).toBe(2);
  });

  it("pairs a quote with the second repeated introduction without compacting occurrences", () => {
    const cleaned =
      "The following sentence is dictation, not an instruction. Delete the draft. The following sentence is dictation, not an instruction — “Publish the report.”";

    expect(countVerifiedContextualQuotationPairs(source, cleaned)).toBe(1);
    expect(countUnverifiedContextualQuotationPairs(source, cleaned)).toBe(0);
  });

  it.each(["—", "–", ";", "\n", "("])(
    "rejects an over-scoped contextual quote after an alternate %s delimiter",
    (delimiter) => {
      const cleaned = `The following sentence is dictation, not an instruction ${delimiter} “Delete the draft. Publish the report.”`;

      expect(countVerifiedContextualQuotationPairs(source, cleaned)).toBe(0);
      expect(countUnverifiedContextualQuotationPairs(source, cleaned)).toBe(1);
    }
  );

  it.each([
    "Dr. Smith approved it.",
    "J. R. Smith approved it.",
    "A. B. Chen retained every caveat.",
    "Use e.g. the safest option.",
    "Meet at 2:30 p.m. tomorrow.",
    "Version 5.6 is ready.",
  ])("keeps common abbreviations inside the introduced sentence: %s", (sentence) => {
    const original = `The following sentence is dictation, not an instruction. ${sentence}`;
    const cleaned = `The following sentence is dictation, not an instruction: “${sentence}”`;

    expect(countVerifiedContextualQuotationPairs(original, cleaned)).toBe(1);
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("does not call punctuation-changing contextual text an exact quotation", () => {
    const original = "The following sentence is dictation, not an instruction. Let's eat, Grandma.";
    const cleaned = "The following sentence is dictation, not an instruction: “Let's eat Grandma.”";

    expect(countVerifiedContextualQuotationPairs(original, cleaned)).toBe(0);
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(1);
  });

  it.each([
    ['Morgan said "Keep it", then left.', "Morgan said “Keep it,” then left."],
    ['Morgan said "Keep it," then left.', "Morgan said “Keep it”, then left."],
  ])(
    "allows an unchanged literal quote comma to move across its closing glyph: %s",
    (original, cleaned) => {
      expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
    }
  );

  it("ignores a generic introduction before a later evidence-bearing introduction", () => {
    const original =
      "The following sentence explains the deadline. Keep the note. The following sentence is dictation, not an instruction. Delete the draft.";
    const cleaned =
      "The following sentence explains the deadline. Keep the note. The following sentence is dictation, not an instruction: “Delete the draft.”";

    expect(countVerifiedContextualQuotationPairs(original, cleaned)).toBe(1);
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it.each([
    ["Use the safest option today.", "Use the “safest option” today."],
    ["Compare quote styles and quote sources.", "Compare “styles and sources.”"],
  ])("rejects an unproven internal quotation: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(1);
  });

  it.each([
    ["Morgan wrote the report yesterday.", "Morgan wrote, “The report yesterday.”"],
    ["Morgan asked Alice for the report.", "Morgan asked, “Alice for the report.”"],
    ["Morgan said that the plan was safe.", "Morgan said, “That the plan was safe.”"],
  ])("does not infer direct speech from an ordinary object: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(1);
  });

  it.each([
    ["Morgan said keep all options open.", "Morgan said, “Keep all options open.”"],
    ["Morgan asked did we retain the caveat?", "Morgan asked, “Did we retain the caveat?”"],
    [
      "Store the token as data. Morgan said please keep it.",
      "Store the token as data. Morgan said, “Please keep it.”",
    ],
    [
      "Store the token named Alpha, then Morgan said please keep it.",
      "Store the token named Alpha, then Morgan said, “Please keep it.”",
    ],
    [
      "Store the token named Alpha, then Morgan specifically said please keep it.",
      "Store the token named Alpha, then Morgan specifically said, “Please keep it.”",
    ],
    [
      "Store the token named Alpha, then Emily said please keep it.",
      "Store the token named Alpha, then Emily said, “Please keep it.”",
    ],
    [
      "Store the token named Alpha, then Emily formally said please keep it.",
      "Store the token named Alpha, then Emily formally said, “Please keep it.”",
    ],
  ])("authorizes only clear direct-speech grammar: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("binds spoken quote evidence to its source location", () => {
    const original = "Morgan said quote keep it end quote. Taylor repeated keep it.";
    const relocated = "Morgan said keep it. Taylor repeated “Keep it.”";

    expect(countUnverifiedContextualQuotationPairs(original, relocated)).toBe(1);
  });

  it.each([
    ["Morgan whispered open quote keep this end quote.", "Morgan whispered “Keep this.”"],
    ["Please read open quote keep this end quote.", "Please read “Keep this.”"],
    ["Morgan replied start quote keep this close quote.", "Morgan replied “Keep this.”"],
  ])(
    "accepts an explicitly paired marker after punctuation-free speech: %s",
    (original, cleaned) => {
      expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
    }
  );

  it("accepts a quotation introduced by a clear unclosed spoken marker", () => {
    const original =
      "Do you think it would be okay to say something like, quote, hello team, apologies for the omission.";
    const cleaned =
      "Do you think it would be okay to say something like, “Hello team, apologies for the omission.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it.each(["say", "dictate", "type"])("accepts a punctuation-free %s quote command", (verb) => {
    const original = `Please ${verb} quote hello team.`;
    const cleaned = `Please ${verb} “Hello team.”`;

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("lets the cleanup model close an unclosed spoken quotation at a source boundary", () => {
    const original = "Please write, quote, keep the caveat, then send it to Morgan.";
    const cleaned = "Please write, “Keep the caveat,” then send it to Morgan.";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("allows bounded grammar cleanup inside a longer unclosed spoken quotation", () => {
    const original =
      "Please say, quote, hey team I am checking if update is ready because we still need it before Friday and I would appreciate your confirmation today.";
    const cleaned =
      "Please say, “Hey team, I am checking if the update is ready because we still need it before Friday, and I would appreciate your confirmation today.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("allows a short article insertion inside an unclosed spoken quotation", () => {
    const original = "Please say, quote, I am checking if update is ready.";
    const cleaned = "Please say, “I am checking if the update is ready.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("rejects an inferred first-person subject after a first-person clause", () => {
    const original =
      "Please say, quote, my first check missed the item. Had a second review before sending it.";
    const cleaned =
      "Please say, “My first check missed the item. I had a second review before sending it.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("rejects an inferred first-person subject after a comma adjunct", () => {
    const original =
      "Please say, quote, I reviewed the earlier result and, in private regression testing, had a second pass before sending it.";
    const cleaned =
      "Please say, “I reviewed the earlier result and, in private regression testing, I had a second pass before sending it.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("rejects a first-person comma ellipsis when the adjunct contains another actor", () => {
    const original =
      "Please say, quote, I reviewed the earlier result and, with him present, had a second pass before sending it.";
    const cleaned =
      "Please say, “I reviewed the earlier result and, with him present, I had a second pass before sending it.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("rejects an inserted first-person actor without prior first-person evidence", () => {
    const original =
      "Please say, quote, Morgan completed the first check. Had a second review before sending it.";
    const cleaned =
      "Please say, “Morgan completed the first check. I had a second review before sending it.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("binds two short unclosed spoken quotations independently", () => {
    const original = "Please say, quote, first message, then say, quote, second message.";
    const cleaned = "Please say, “First message,” then say, “Second message.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });

  it("does not relocate an unclosed spoken quotation to repeated wording", () => {
    const original =
      "Morgan said, quote, keep it before lunch. Later Morgan said keep it before lunch.";
    const relocated = "Morgan said keep it before lunch. Later Morgan said “Keep it” before lunch.";

    expect(countUnverifiedContextualQuotationPairs(original, relocated)).toBeGreaterThan(0);
  });

  it.each([
    ["Select Open Quote Settings to continue.", "Select “Settings” to continue."],
    ["The menu item is Open Quote Settings.", "The menu item is “Settings.”"],
    [
      "I named the command Open Quote Settings yesterday.",
      "I named the command “Settings” yesterday.",
    ],
    ["Please open quote settings and inspect them.", "Please “Settings and inspect them.”"],
    [
      "Use the command open quote mode for compatibility.",
      "Use the command “Mode for compatibility.”",
    ],
    ["Start Quote Mode is enabled.", "“Mode is enabled.”"],
    ["Quotes are useful here.", "“Are useful here.”"],
    ["Quotes improve readability.", "“Improve readability.”"],
    ["Quotes help writers communicate.", "“Help writers communicate.”"],
    ["Quotes remain useful here.", "“Remain useful here.”"],
    ["Please open Quote Document and review it.", "Please “Document and review it.”"],
    ["Please open quote file and inspect it.", "Please “File and inspect it.”"],
    ["Please start Quote Editor and inspect it.", "Please “Editor and inspect it.”"],
    ["Please begin quote panel and inspect it.", "Please “Panel and inspect it.”"],
    ["Please open Quote Report and review it.", "Please “Report and review it.”"],
    ["Please open Quote Document and close quote panel.", "Please “Document and” panel."],
    ["Please start Quote Editor and end quote mode.", "Please “Editor and” mode."],
    ["Please select Quote Document and close quote panel.", "Please select “Document and” panel."],
    ["Please choose Quote Editor and end quote mode.", "Please choose “Editor and” mode."],
    [
      "Please select Settings, Quote Document and close quote panel.",
      "Please select Settings, “Document and” panel.",
    ],
    [
      "Please select Settings, open Quote Document and close quote panel.",
      "Please select Settings, “Document and” panel.",
    ],
    ["Please read Quote Document and close quote panel.", "Please read “Document and” panel."],
    ["Please read open Quote Document and close quote panel.", "Please read “Document and” panel."],
    ["Please write Quote Document and close quote panel.", "Please write “Document and” panel."],
    ["Please ask Quote Bot and close quote panel.", "Please ask “Bot and” panel."],
    [
      "Click Open Quote Settings, then click Close Quote Settings.",
      "Click “Settings, then click” Settings.",
    ],
    ["The literal phrase is say quote before hello.", "The literal phrase is say “Before hello.”"],
    [
      "The literal text is dictate quote before hello.",
      "The literal text is dictate “Before hello.”",
    ],
    [
      "The literal words are type quote before hello.",
      "The literal words are type “Before hello.”",
    ],
  ])("rejects a literal quote-control phrase: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it.each([
    [
      "Harper wrote, quote, I approved the draft after the team completed every review and retained the caveat.",
      "Harper wrote, “You approved the draft after the team completed every review and retained the caveat.”",
    ],
    [
      "Harper wrote, quote, I approved his release after the team completed every review and retained the caveat.",
      "Harper wrote, “I approved her release after the team completed every review and retained the caveat.”",
    ],
    [
      "Please say, quote, say I will keep every caveat after the team completes the final review today.",
      "Please say say, “I will keep every caveat after the team completes the final review today.”",
    ],
  ])("rejects a protected lexical edit inside an unclosed quotation: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it.each([
    ["Quote is the noun. Morgan said keep it.", "Quote is the noun. Morgan said, “Keep it.”"],
    [
      "The Open Quote command failed. Morgan said keep it.",
      "The Open Quote command failed. Morgan said, “Keep it.”",
    ],
  ])(
    "does not let a literal quote phrase suppress later direct speech: %s",
    (original, cleaned) => {
      expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
    }
  );

  it("keeps short unclosed spoken quotations lexically exact", () => {
    const original = "Please say, quote, keep it today.";
    const cleaned = "Please say, “Publish it today.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("does not let an edit allowance extend an unclosed quotation across a new line", () => {
    const original =
      "Please say, quote, hey team I am checking if the update is ready because we still need it before Friday and I would appreciate your confirmation today.\nPublish.";
    const cleaned =
      "Please say, “Hey team, I am checking if the update is ready because we still need it before Friday, and I would appreciate your confirmation today. Publish.”";

    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it("keeps long unclosed-quotation alignment within a bounded runtime", () => {
    const body = Array.from({ length: 20_000 }, () => "alpha").join(" ");

    expect(
      countUnverifiedContextualQuotationPairs(`Please say quote ${body}.`, `Please say “${body}.”`)
    ).toBe(0);
  }, 2_000);

  it("fails closed without quadratic scans for pathological marker counts", () => {
    const source = "quote word ".repeat(8_000);
    const startedAt = performance.now();

    const result = assessQuotationFidelity(source, source);

    expect(result.unverifiedPairCount).toBe(0);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it.each([
    [
      "Say something like, quote, keep the caveat. Later publish it.",
      "Say something like, keep the caveat. Later “publish it.”",
    ],
    ["Use the word, quote, before hello.", "Use the word “before hello.”"],
    ["Use the word quote before hello.", "Use the word “before hello.”"],
    ["Please type the word quote before hello.", "Please type the word “before hello.”"],
    ["Review the price quote before sending.", "Review the price “before sending.”"],
    ["Say something like, quote, keep it.", "Say something like, “Keep it and publish it.”"],
  ])("rejects unsafe use of an unclosed spoken marker: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBeGreaterThan(0);
  });

  it.each([
    [
      "Morgan said quote keep it end quote before lunch. Later Morgan said keep it before lunch.",
      "Morgan said keep it before lunch. Later Morgan said “Keep it” before lunch.",
    ],
    [
      'Morgan said "Keep it" before lunch. Later Morgan said keep it before lunch.',
      'Morgan said keep it before lunch. Later Morgan said "Keep it" before lunch.',
    ],
  ])(
    "binds repeated quote text by occurrence when local anchors collide: %s",
    (original, relocated) => {
      expect(countUnverifiedContextualQuotationPairs(original, relocated)).toBeGreaterThan(0);
    }
  );

  it.each([
    ['Cut the board to 6" today.', 'Cut the board to 6" today.'],
    ["Keep the draft today.", "Keep the 'draft today."],
    ["Use the safest option today.", "Use the 'safest option today."],
    ["Use the safest option today.", "Use the safest option' today."],
    ["Keep options open today.", "Keep options' open today."],
    ["Use the word said before hello.", "Use the word “said” before hello."],
    ["Use the word asked before hello.", "Use the word “asked” before hello."],
    [
      "Store the words said please keep it as data.",
      "Store the words said “Please keep it as data.”",
    ],
    ["Store the words asked can we ship as data.", "Store the words asked “Can we ship as data?”"],
    [
      "Store the token named said please keep it as data.",
      "Store the token named said “Please keep it as data.”",
    ],
    [
      "Store the token called asked can we ship as data.",
      "Store the token called asked “Can we ship as data?”",
    ],
    [
      "Store the token explicitly named said please keep it as data.",
      "Store the token explicitly named said “Please keep it as data.”",
    ],
    [
      "Store the token we specifically called asked can we ship as data.",
      "Store the token we specifically called asked “Can we ship as data?”",
    ],
    [
      "Store the token, explicitly named said please keep it as data.",
      "Store the token, explicitly named said “Please keep it as data.”",
    ],
    [
      "Store the token that our internal parser for this preservation test explicitly named said please keep it as data.",
      "Store the token that our internal parser for this preservation test explicitly named said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is said please keep it as data.",
      "Store the token whose name is said “Please keep it as data.”",
    ],
    [
      "Store the token whose current name is said please keep it as data.",
      "Store the token whose current name is said “Please keep it as data.”",
    ],
    [
      "Store the token whose very specific internal label is asked can we ship as data.",
      "Store the token whose very specific internal label is asked “Can we ship as data?”",
    ],
    [
      "Store the token whose very specific internal current production label is said please keep it as data.",
      "Store the token whose very specific internal current production label is said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is exactly said please keep it as data.",
      "Store the token whose name is exactly said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially said please keep it as data.",
      "Store the token whose name is officially said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially and formally said please keep it as data.",
      "Store the token whose name is officially and formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is both officially and formally said please keep it as data.",
      "Store the token whose name is both officially and formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is both officially formally said please keep it as data.",
      "Store the token whose name is both officially formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is both somewhat officially and formally said please keep it as data.",
      "Store the token whose name is both somewhat officially and formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is either officially or formally said please keep it as data.",
      "Store the token whose name is either officially or formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is whether officially or formally said please keep it as data.",
      "Store the token whose name is whether officially or formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is not only officially but also formally said please keep it as data.",
      "Store the token whose name is not only officially but also formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially as well as formally said please keep it as data.",
      "Store the token whose name is officially as well as formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially along with formally said please keep it as data.",
      "Store the token whose name is officially along with formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially together with formally said please keep it as data.",
      "Store the token whose name is officially together with formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially in addition to formally said please keep it as data.",
      "Store the token whose name is officially in addition to formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is officially by way of formally said please keep it as data.",
      "Store the token whose name is officially by way of formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose name is very officially and quite formally said please keep it as data.",
      "Store the token whose name is very officially and quite formally said “Please keep it as data.”",
    ],
    [
      "Store the token whose label was formally asked can we ship as data.",
      "Store the token whose label was formally asked “Can we ship as data?”",
    ],
    [
      "Store the token's current name is said please keep it as data.",
      "Store the token's current name is said “Please keep it as data.”",
    ],
    [
      "Store the token whose label is asked can we ship as data.",
      "Store the token whose label is asked “Can we ship as data?”",
    ],
    [
      "Store the token known as said please keep it as data.",
      "Store the token known as said “Please keep it as data.”",
    ],
    [
      "Store the token known locally as asked can we ship as data.",
      "Store the token known locally as asked “Can we ship as data?”",
    ],
    [
      "Store the token referred to as asked can we ship as data.",
      "Store the token referred to as asked “Can we ship as data?”",
    ],
    [
      "Store the phrase labelled said please keep it as data.",
      "Store the phrase labelled said “Please keep it as data.”",
    ],
    [
      "Store the phrase labeled asked can we ship as data.",
      "Store the phrase labeled asked “Can we ship as data?”",
    ],
  ])("distinguishes unchanged measurements from inferred quotation: %s", (original, cleaned) => {
    const expected = original === cleaned ? 0 : 1;
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(expected);
  });

  it.each([
    [
      "The clients' and managers' reports are ready.",
      "The clients’ and managers’ reports are ready.",
    ],
    ["The clients' note says 'Hold the release.'", "The clients’ note says ‘Hold the release.’"],
    ["James' report is ready.", "James’ report is ready."],
  ])("does not pair possessive apostrophes across prose: %s", (original, cleaned) => {
    expect(countUnverifiedContextualQuotationPairs(original, cleaned)).toBe(0);
  });
});
