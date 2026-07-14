import { describe, expect, it } from "vitest";

import {
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
