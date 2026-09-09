/**
 * ServiceDriver
 *
 * SDK 服务类(Geocoder/Convertor/Geolocation/LocalCity/Boundary/Autocomplete/
 * ViewAnimation/TrackAnimation)统一由 Driver 创建，业务层拿 ServiceHandle。
 */
import type { MapHandle, ServiceHandle } from "./handles";
import type { Point } from "./geometry";

export interface AutocompleteOptions {
  input: HTMLInputElement;
  location?: unknown;
  types?: string[];
  onSearchComplete?: (event: unknown) => void;
}

export interface ServiceDriver {
  createGeocoder(): ServiceHandle<"service:geocoder">;
  createConvertor(): ServiceHandle<"service:convertor">;
  createGeolocation(options?: Record<string, unknown>): ServiceHandle<"service:geolocation">;
  createLocalCity(): ServiceHandle<"service:local-city">;
  createBoundary(): ServiceHandle<"service:boundary">;
  createAutocomplete(options: AutocompleteOptions): ServiceHandle<"service:autocomplete">;
  createViewAnimation(
    keyFrames: readonly Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:view-animation">;
  createTrackAnimation(
    map: MapHandle,
    path: readonly Point[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:track-animation">;
}
