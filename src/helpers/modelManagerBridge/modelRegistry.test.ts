import { describe, expect, it } from "vitest";

const { findModelById, getDownloadUrl, getLocalProviders } = require("./modelRegistry");

describe("modelManagerBridge modelRegistry", () => {
  it("returns local providers and can find a known model", () => {
    const providers = getLocalProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);

    const firstProvider = providers[0];
    const firstModel = firstProvider.models?.[0];
    expect(firstModel?.id).toBeTruthy();

    const result = findModelById(firstModel.id);
    expect(result).toEqual(
      expect.objectContaining({
        model: expect.objectContaining({ id: firstModel.id }),
        provider: expect.objectContaining({ id: firstProvider.id }),
      })
    );
  });

  it("builds a Hugging Face resolve URL", () => {
    const providers = getLocalProviders();
    const provider = providers[0];
    const model = provider.models[0];
    const url = getDownloadUrl(provider, model);
    expect(url).toContain(model.hfRepo);
    expect(url).toContain(`/resolve/main/${model.fileName}`);
  });
});

