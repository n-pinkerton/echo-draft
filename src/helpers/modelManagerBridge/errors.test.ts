import { describe, expect, it } from "vitest";

const { ModelError, ModelNotFoundError } = require("./errors");

describe("modelManagerBridge errors", () => {
  it("ModelError carries code and details", () => {
    const err = new ModelError("boom", "E_CODE", { a: 1 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ModelError");
    expect(err.message).toBe("boom");
    expect(err.code).toBe("E_CODE");
    expect(err.details).toEqual({ a: 1 });
  });

  it("ModelNotFoundError uses MODEL_NOT_FOUND code", () => {
    const err = new ModelNotFoundError("m-1");
    expect(err.code).toBe("MODEL_NOT_FOUND");
    expect(err.details).toEqual({ modelId: "m-1" });
  });
});

