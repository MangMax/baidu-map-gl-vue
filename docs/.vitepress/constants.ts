import type { Component } from "vue";

export const examplePath = /(\.\.\/)*examples\//g;

type ExampleModule = { default: Component };

export const exampleModuleMap: Record<string, Component> = ((modules, reg) => {
  const map: Record<string, Component> = {};
  Object.entries(modules).forEach(([key, module]) => {
    map[key.replace(reg, "").replace(/\.vue$/, "")] = module.default;
  });
  return map;
})(import.meta.glob<ExampleModule>("../examples/**/*.vue", { eager: true }), examplePath);
