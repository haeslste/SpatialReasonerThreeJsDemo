export interface ObjectVisualPolicy {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  castShadow: boolean;
}

export function objectVisualPolicy(
  baseOpacity: number,
  hasResults: boolean,
  isResult: boolean,
  isSelected: boolean,
  isArchitecture: boolean,
): ObjectVisualPolicy {
  const isContext = hasResults && !isResult && !isSelected;
  const opacity = isContext ? Math.min(baseOpacity, isArchitecture ? 0.38 : 0.6) : baseOpacity;
  const opaque = opacity >= 0.999;
  return {
    opacity,
    transparent: !opaque,
    depthWrite: opaque,
    // A translucent contextual object must not cast a fully opaque ghost shadow.
    castShadow: !isContext && opaque,
  };
}
