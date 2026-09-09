/**
 * PanoramaDriver
 *
 * 全景能力（viewer/service）后续阶段补全；当前先以 capability 表达支持状态。
 */
export interface PanoramaDriver {
  readonly supported: boolean;
}
