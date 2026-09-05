import { describe, it, expect, vi, beforeEach } from "vitest";
import { DataLayerManager, type DataLayerHost } from "./DataLayerManager";

interface Item {
  id: string;
  lng: number;
  lat: number;
}

function makeHost() {
  const createMarker = vi.fn((item: Item) => ({ id: item.id, lng: item.lng, lat: item.lat }));
  const removeMarker = vi.fn();
  const updatePosition = vi.fn();
  const host: DataLayerHost<any> = { createMarker, removeMarker, updatePosition };
  return { host, createMarker, removeMarker, updatePosition };
}

const items: Item[] = [
  { id: "a", lng: 1, lat: 1 },
  { id: "b", lng: 2, lat: 2 },
  { id: "c", lng: 3, lat: 3 },
];

describe("DataLayerManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates markers for initial batch", () => {
    const { host, createMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(items, (i) => i.id);
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(3);
    m.dispose();
  });

  it("diffs subsequent sync: added + removed", () => {
    const { host, createMarker, removeMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(items, (i) => i.id);
    m.flush();
    m.sync(
      [
        { id: "a", lng: 1, lat: 1 },
        { id: "b", lng: 9, lat: 9 },
        { id: "d", lng: 4, lat: 4 },
      ],
      (i) => i.id,
    );
    m.flush();
    expect(createMarker).toHaveBeenCalledTimes(4); // 3 initial + d
    expect(removeMarker).toHaveBeenCalledTimes(1); // removed c
    m.dispose();
  });

  it("force replaces all", () => {
    const { host, createMarker, removeMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(items, (i) => i.id);
    m.flush();
    m.sync([{ id: "x", lng: 5, lat: 5 }], (i) => i.id, undefined, true);
    m.flush();
    expect(removeMarker).toHaveBeenCalledTimes(3);
    expect(createMarker).toHaveBeenCalledTimes(4);
    expect(m.size).toBe(1);
    m.dispose();
  });

  it("clear removes all markers and resets", () => {
    const { host, removeMarker } = makeHost();
    const m = new DataLayerManager(host);
    m.sync(items, (i) => i.id);
    m.flush();
    m.clear();
    expect(removeMarker).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(0);
    m.dispose();
  });
});
