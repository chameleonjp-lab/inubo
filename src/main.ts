import './style.css';
import { App } from './ui/screens';

/**
 * 入口。URL の検査用パラメーター:
 * - ?debug=1 … 入力の長さ・軌跡・判定名を画面に出す（試験時だけ）
 * - ?autoplay=safe|short|trick&speed=8 … 自動操縦で走らせる（通し試験・自動再生）
 * - ?ranking=mock … 公開順位を試験用の接続先（端末内の模擬サーバー）で動かす
 * 正式な公開順位の接続先は、公開段階で確認してから設定する。それまでは順位の送信と導線を止めておく。
 */
const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const app = new App(root, {
  autoplay: params.get('autoplay'),
  speed: Math.max(1, Math.min(20, Number(params.get('speed') ?? '1') || 1)),
  debug: params.get('debug') === '1',
  ranking: params.get('ranking') === 'mock' ? 'mock' : 'off',
});
app.showHome();
(window as unknown as { __inubo?: unknown }).__inubo = { app, ready: true };
