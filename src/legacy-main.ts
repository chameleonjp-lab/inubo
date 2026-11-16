import './style.css';
import { App } from './ui/screens';
import { readPlayOptions } from './app-options';
import { MockRankingServer } from './ranking/mockServer';
import { createProductionTransport } from './ranking/production';

/**
 * 入口。URL の検査用パラメーター:
 * - ?debug=1 … 入力の長さ・軌跡・判定名を画面に出す（試験時だけ）
 * - ?autoplay=safe|short|trick&speed=8 … 自動操縦で走らせる（通し試験・自動再生）
 * - ?ranking=mock … 公開順位を試験用の接続先（端末内の模擬サーバー）で動かす
 * 正式な公開順位の接続先は、公開段階で確認してから設定する。それまでは順位の送信と導線を止めておく。
 */
const testBuild = import.meta.env.MODE === 'e2e';
const opts = readPlayOptions(location.search, testBuild);
const transport = testBuild
  ? (opts.mockRanking ? new MockRankingServer() : null)
  : createProductionTransport();
const root = document.getElementById('app')!;
const app = new App(root, opts, transport);
app.showHome();
if (testBuild) (window as unknown as { __inubo?: unknown }).__inubo = { app, ready: true };
