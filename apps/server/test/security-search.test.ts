import { expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/ai", () => ({ MODELS: { fast: "test" }, openai: { responses: { create } } }));
import { webSearchAll, webTools } from "../src/agent/tools/web";

it("propagates OpenAI search failures without an HTML scraping fallback", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  create.mockRejectedValueOnce(new Error("search unavailable"));
  await expect(webSearchAll("test query")).rejects.toThrow("search unavailable");
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it("keeps OpenAI citations and empty search results", async () => {
  create.mockResolvedValueOnce({ output: [], output_text: "", usage: {} });
  expect((await webSearchAll("test query")).results).toEqual([]);
  create.mockResolvedValueOnce({
    output: [{ content: [{ annotations: [{ type: "url_citation", url: "https://example.com", title: "Example" }] }] }],
    output_text: "A cited result",
    usage: {},
  });
  expect((await webSearchAll("test query")).results[0]?.url).toBe("https://example.com");
});

it("attributes weather data to Open-Meteo", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ name: "Example", latitude: 1, longitude: 2 }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ current: {}, daily: {} })));
  const ctx = { setStatus: async () => {}, activity: async () => {} };
  const result = await webTools.find((t) => t.name === "weather")!.run({ place: "Example" }, ctx as Parameters<(typeof webTools)[number]["run"]>[1]);
  expect(result).toHaveProperty("attribution", "Weather data by Open-Meteo.com");
  fetchSpy.mockRestore();
});
