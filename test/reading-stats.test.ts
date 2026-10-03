import { assert } from "chai";
import {
  formatReadingDuration,
  readingSecondsToLevel,
} from "../src/modules/reading-stats/ReadingStatsService.ts";
import {
  parseZoteroStyleProgressMap,
  sumZoteroStyleReadingSeconds,
} from "../src/modules/reading-stats/ZoteroStyleReadingImport.ts";

describe("reading stats helpers", function () {
  it("formats short and long durations", function () {
    assert.equal(formatReadingDuration(45), "45s");
    assert.equal(formatReadingDuration(125), "2 min");
    assert.equal(formatReadingDuration(3720), "1 h 2 min");
  });

  it("maps reading seconds to heatmap levels", function () {
    assert.equal(readingSecondsToLevel(0, 3600), 0);
    assert.equal(readingSecondsToLevel(900, 3600), 2);
    assert.equal(readingSecondsToLevel(3600, 3600), 4);
  });

  it("sums Zotero Style per-page reading seconds", function () {
    assert.equal(sumZoteroStyleReadingSeconds(undefined), 0);
    assert.equal(
      sumZoteroStyleReadingSeconds({ "0": 1500, "1": 500, "2": 10 }),
      2010,
    );
    const map = parseZoteroStyleProgressMap({
      AIRDNXFE: { readingTime: { page: 11, data: { "0": 100, "1": 40 } } },
      undefined: { readingTime: { page: 1, data: { "0": 999 } } },
    });
    assert.equal(
      sumZoteroStyleReadingSeconds(map.AIRDNXFE.readingTime?.data),
      140,
    );
  });
});
