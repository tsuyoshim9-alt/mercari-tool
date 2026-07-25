// ローカル動作確認用の簡易サーバー（Node標準機能のみ・追加インストール不要）
// 使い方:  node --env-file=.env dev-server.mjs
// ブラウザで http://localhost:8888 を開く
//
// public/ の静的ファイルを配信し、
// /.netlify/functions/analyze への POST を analyze.mjs のハンドラに渡します。
// 本番（Netlify）ではこのファイルは使われません。

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './netlify/functions/analyze.mjs';

const PORT = process.env.PORT || 8888;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 写真解析（タイトル・説明文生成）APIプロキシ
  if (url.pathname === '/.netlify/functions/analyze') {
    try {
      const body = await readBody(req);
      const result = await handler({
        httpMethod: req.method,
        body,
        headers: req.headers,
      });
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
    } catch (err) {
      // 万一ハンドラ内で例外が出ても、必ず応答を返す（ブラウザを固まらせない）
      console.error('handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'サーバー内部エラー: ' + (err.message || err) }));
    }
    return;
  }

  // 静的ファイル配信
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(ROOT, path));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      // ブラウザにキャッシュさせない（常に最新のファイルを読み込ませる）
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  ✅ 起動しました → http://localhost:${PORT}\n  停止するには Ctrl + C\n`);
});
