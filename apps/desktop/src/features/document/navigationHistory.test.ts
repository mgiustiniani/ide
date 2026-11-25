import { describe, expect, it } from "vitest";
import { NavigationHistory } from "./navigationHistory";
const location = (filePath: string, lineNumber = 1, column = 1) => ({
  filePath,
  point: { lineNumber, column },
});
describe("editor navigation locations", () => {
  it("retains exact origins, coalesces file-open observation and records same-file jumps", () => {
    const history = new NavigationHistory();
    history.record(null, location("A.java", 7, 4));
    history.record(location("A.java", 12, 9), location("B.java"));
    history.record(location("A.java", 12, 9), location("B.java", 20, 3));
    expect(history.destination(-1)?.location).toEqual(location("A.java", 12, 9));
    history.record(location("B.java", 20, 3), location("B.java", 40, 2));
    expect(history.destination(-1)?.location).toEqual(location("B.java", 20, 3));
  });
  it("retains a forward return position and removes the forward branch after a new jump", () => {
    const history = new NavigationHistory();
    history.record(location("A.java", 5), location("B.java", 10));
    history.commit(0, location("B.java", 33));
    expect(history.destination(1)?.location).toEqual(location("B.java", 33));
    history.record(location("A.java", 8), location("C.java", 50));
    expect(history.destination(1)).toBeNull();
    expect(history.destination(-1)?.location).toEqual(location("A.java", 8));
  });
  it("skips unavailable retained previews without opening them", () => {
    const history = new NavigationHistory();
    history.record(location("A.java"), location("library://closed", 10));
    history.record(location("library://closed", 10), location("B.java", 20));
    expect(history.destination(-1, (path) => !path.startsWith("library:"))?.location).toEqual(
      location("A.java"),
    );
  });
  it("follows committed simultaneous path renames without losing positions", () => {
    const history = new NavigationHistory();
    history.record(location("A.java", 5), location("B.java", 9));
    history.rename([
      { oldPath: "A.java", path: "B.java" },
      { oldPath: "B.java", path: "A.java" },
    ]);
    expect(history.current).toEqual(location("A.java", 9));
    expect(history.destination(-1)?.location).toEqual(location("B.java", 5));
  });
  it("bounds retained locations and ignores duplicate stops", () => {
    const history = new NavigationHistory(3);
    for (let i = 0; i < 6; i++) history.record(null, location(`${i}.java`));
    history.record(null, location("5.java"));
    history.commit(0, null);
    expect(history.current).toEqual(location("3.java"));
    expect(history.destination(-1)).toBeNull();
    history.clear();
    expect(history.current).toBeUndefined();
    expect(history.destination(1)).toBeNull();
  });
});
