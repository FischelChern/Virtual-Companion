import { describe, expect, it } from "vitest";
import { classifyModelEndpoint } from "./model-endpoint.js";

describe("classifyModelEndpoint", () => {
  it.each([
    ["https://api.openai.com/v1", "external"],
    ["http://127.0.0.1:11434/v1", "local"],
    ["http://192.168.1.8:8000/v1", "local"],
    ["https://host.docker.internal/v1", "local"],
    ["http://api.example.test/v1", "unknown"],
    [undefined, "unknown"],
  ] as const)("classifies %s as %s", (baseUrl, expected) => {
    expect(classifyModelEndpoint(baseUrl)).toBe(expected);
  });
});
