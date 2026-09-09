/**
 * 图标规范化与缓存
 *
 * - 缓存 key 基于规范化 descriptor
 * - 相同 descriptor 可共享只读 Icon
 * - cache 使用上限或 LRU,避免无限增长
 */
export interface IconDescriptor {
  imageUrl: string;
  width: number;
  height: number;
  anchorX?: number;
  anchorY?: number;
  imageOffsetX?: number;
  imageOffsetY?: number;
  imageSizeWidth?: number;
  imageSizeHeight?: number;
}

/** 将 icon prop 规范化为可比较的 descriptor */
export function normalizeIconDescriptor(
  input: Partial<IconDescriptor> & Record<string, unknown>,
): IconDescriptor {
  const size = (input.size ?? {}) as { width?: number; height?: number };
  const imageSize = (input.imageSize ?? {}) as { width?: number; height?: number };
  const anchor = (input.anchor ?? {}) as { x?: number; y?: number };
  const imageOffset = (input.imageOffset ?? {}) as { x?: number; y?: number };
  return {
    imageUrl: String(input.imageUrl ?? ""),
    width: size.width ?? 0,
    height: size.height ?? 0,
    anchorX: anchor.x,
    anchorY: anchor.y,
    imageOffsetX: imageOffset.x,
    imageOffsetY: imageOffset.y,
    imageSizeWidth: imageSize.width,
    imageSizeHeight: imageSize.height,
  };
}

/** 稳定 key:按 descriptor 字段序列化 */
export function iconCacheKey(d: IconDescriptor): string {
  return [
    d.imageUrl,
    d.width,
    d.height,
    d.anchorX ?? "",
    d.anchorY ?? "",
    d.imageOffsetX ?? "",
    d.imageOffsetY ?? "",
    d.imageSizeWidth ?? "",
    d.imageSizeHeight ?? "",
  ].join("|");
}

export interface IconCache<Icon> {
  get(descriptor: IconDescriptor, factory: () => Icon): Icon;
  clear(): void;
  get size(): number;
}

/** LRU 有界图标缓存 */
export function createLruIconCache<Icon>(maxSize = 200): IconCache<Icon> {
  const map = new Map<string, Icon>();
  return {
    get(descriptor, factory) {
      const key = iconCacheKey(descriptor);
      const existing = map.get(key);
      if (existing) {
        // LRU:移到末尾
        map.delete(key);
        map.set(key, existing);
        return existing;
      }
      const created = factory();
      map.set(key, created);
      if (map.size > maxSize) {
        // 淘汰最久未用(head)
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      return created;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}
