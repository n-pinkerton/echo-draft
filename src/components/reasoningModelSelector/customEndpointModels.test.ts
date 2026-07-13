import { describe, expect, it } from "vitest";
import { fetchCustomEndpointModels, mapModelsPayloadToOptions } from "./customEndpointModels";

describe("customEndpointModels", () => {
  describe("mapModelsPayloadToOptions", () => {
    it("maps OpenAI-compatible payloads under data[]", () => {
      const options = mapModelsPayloadToOptions({
        data: [{ id: "gpt-4.1", owned_by: "openai" }],
      });

      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe("gpt-4.1");
      expect(options[0]?.label).toBe("gpt-4.1");
      expect(options[0]?.ownedBy).toBe("openai");
      expect(options[0]?.icon).toBeTruthy();
      expect(options[0]?.invertInDark).toBe(true);
    });

    it("maps payloads under models[]", () => {
      const options = mapModelsPayloadToOptions({
        models: [{ name: "local-llm", owned_by: "localai" }],
      });

      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe("local-llm");
      expect(options[0]?.label).toBe("local-llm");
    });
  });

  describe("fetchCustomEndpointModels", () => {
    it("returns [] when baseUrl is empty", async () => {
      const options = await fetchCustomEndpointModels({ baseUrl: "" });
      expect(options).toEqual([]);
    });

    it("rejects baseUrls missing a protocol", async () => {
      await expect(fetchCustomEndpointModels({ baseUrl: "api.openai.com/v1" })).rejects.toThrow(
        /including protocol/i
      );
    });

    it("rejects non-private http endpoints", async () => {
      await expect(fetchCustomEndpointModels({ baseUrl: "http://example.com/v1" })).rejects.toThrow(
        /HTTPS required/i
      );
    });

    it("uses the secure model-discovery bridge and maps options", async () => {
      const requestFn = async (endpoint: string) => {
        expect(endpoint).toBe("https://example.com/v1/models");
        return {
          status: 200,
          body: JSON.stringify({ data: [{ id: "gpt-4.1", owned_by: "openai" }] }),
        };
      };

      const options = await fetchCustomEndpointModels({
        baseUrl: "https://example.com/v1",
        requestFn,
      });

      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe("gpt-4.1");
    });

    it("rejects malformed model-discovery responses", async () => {
      await expect(
        fetchCustomEndpointModels({
          baseUrl: "https://example.com/v1",
          requestFn: async () => ({ status: 200, body: "not-json" }),
        })
      ).rejects.toThrow(/invalid JSON/i);
    });
  });
});
