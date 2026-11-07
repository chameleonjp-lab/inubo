export interface PlayOptions {
  testBuild: boolean;
  autoplay: string | null;
  speed: number;
  debug: boolean;
  mockRanking: boolean;
}

export function readPlayOptions(search: string, testBuild: boolean): PlayOptions {
  if (!testBuild) return { testBuild, autoplay: null, speed: 1, debug: false, mockRanking: false };

  const params = new URLSearchParams(search);
  const route = params.get('autoplay');
  const autoplay = route === 'safe' || route === 'short' || route === 'trick' ? route : null;
  return {
    testBuild,
    autoplay,
    speed: autoplay ? Math.max(1, Math.min(20, Number(params.get('speed')) || 1)) : 1,
    debug: params.get('debug') === '1',
    mockRanking: params.get('ranking') === 'mock',
  };
}
