import { describe, expect, test } from "bun:test";
import { celsiusToFahrenheit, formatHearthTempF } from "./temp";

describe("celsiusToFahrenheit", () => {
  test("0°C is 32°F", () => expect(celsiusToFahrenheit(0)).toBe(32));
  test("100°C is 212°F", () => expect(celsiusToFahrenheit(100)).toBe(212));
});

describe("formatHearthTempF", () => {
  test("rounds and suffixes °F", () => expect(formatHearthTempF(232.2)).toBe("450°F"));
  test("em-dash placeholder for null", () => expect(formatHearthTempF(null)).toBe("—"));
});
