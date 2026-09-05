/**
 * useBMapMarkerIcons —— 内置默认图标(方案 §13.2)
 *
 * 提供 BMapGL 官方默认 marker 图标集(经 map context ready 后创建,
 * 避免全局 BMapGL 依赖与模块级 icon 缓存)。
 */

export type MarkerIconName =
  | "simple_red"
  | "simple_blue"
  | "loc_red"
  | "loc_blue"
  | "start"
  | "end"
  | "location"
  | "red1"
  | "red2"
  | "red3"
  | "red4"
  | "red5"
  | "red6"
  | "red7"
  | "red8"
  | "red9"
  | "red10"
  | "blue1"
  | "blue2"
  | "blue3"
  | "blue4"
  | "blue5"
  | "blue6"
  | "blue7"
  | "blue8"
  | "blue9"
  | "blue10";

const DEFAULT_ICON_URL = "//mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";

type IconCtor = {
  Icon: new (url: string, size: unknown, opts?: Record<string, unknown>) => unknown;
  Size: new (w: number, h: number) => unknown;
};

/** 图标布局(雪碧图 offset):name → [offsetX, offsetY, width, height] */
const ICON_MAP: Record<MarkerIconName, [number, number, number, number]> = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
  red1: [0, 0, 38, 38],
  red2: [38, 0, 38, 38],
  red3: [76, 0, 38, 38],
  red4: [114, 0, 38, 38],
  red5: [152, 0, 38, 38],
  red6: [190, 0, 38, 38],
  red7: [228, 0, 38, 38],
  red8: [266, 0, 38, 38],
  red9: [304, 0, 38, 38],
  red10: [342, 0, 38, 38],
  blue1: [0, 38, 38, 38],
  blue2: [38, 38, 38, 38],
  blue3: [76, 38, 38, 38],
  blue4: [114, 38, 38, 38],
  blue5: [152, 38, 38, 38],
  blue6: [190, 38, 38, 38],
  blue7: [228, 38, 38, 38],
  blue8: [266, 38, 38, 38],
  blue9: [304, 38, 38, 38],
  blue10: [342, 38, 38, 38],
};

/**
 * 构建默认图标集合。
 * @param api SDK namespace(经 map context ready 获取)
 * @returns 名称 → Icon 实例
 */
export function useBMapMarkerIcons(api: unknown): Record<string, unknown> {
  const { Icon, Size } = api as IconCtor;
  const icons: Record<string, unknown> = {};
  for (const [name, [ox, oy, w, h]] of Object.entries(ICON_MAP)) {
    icons[name] = new Icon(DEFAULT_ICON_URL, new Size(w / 2, h / 2), {
      imageOffset: new Size(ox / 2, oy / 2),
      imageSize: new Size(600 / 2, 600 / 2),
    });
  }
  return icons;
}

