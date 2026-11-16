// 確認版は本番App・保存・送信のモジュールを読み込まない。
const start = import.meta.env.MODE === 'review'
  ? import('./ui/free-review').then(m => m.startFreeReview(document.getElementById('app')!))
  : import('./legacy-main');
start.catch(() => { document.getElementById('app')!.textContent = '起動できません。ページを再読み込みしてください。'; });
