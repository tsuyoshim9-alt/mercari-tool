const Anthropic = require('@anthropic-ai/sdk');

const ANALYSIS_PROMPT = `あなたはメルカリでブランド品・アパレルを販売するエキスパートです。
提供された商品写真を詳細に解析し、以下の構造でJSONのみを返してください。
マークダウンコードブロックや説明文は不要です。JSONそのものだけ返してください。

{
  "category": "バッグ・スーツ・上着・パンツ・アパレル小物・その他 から最も近いもの",
  "brand": "ブランド名（不確かなら「推定: ○○」、不明なら「不明」）",
  "item_name": "具体的なアイテム名（例: ショルダーバッグ、テーラードジャケット）",
  "color": "主な色（複数なら「ブラック×ゴールド」のように記載）",
  "material": "素材（不確かなら「レザー（要確認）」のように記載）",
  "pattern": "柄・デザイン（例: 無地、ストライプ、モノグラム）",
  "features": ["デザインの特徴1", "特徴2", "特徴3"],
  "condition": "新品同様・未使用に近い・目立った傷や汚れなし・やや傷や汚れあり・傷や汚れあり から選択",
  "damage": "傷・汚れ・スレ・使用感の詳細（写真から確認できる範囲で正直に記載。問題なければ「写真から確認できる範囲では目立ったダメージなし」）",
  "model_number": "型番・品番・タグ情報（読み取れれば記載、不明なら「確認不可」）",
  "hardware": "ロゴ・刻印・金具・ファスナーなどの特徴（なければ「特記事項なし」）",
  "size_info": "タグに記載のサイズ（読み取れれば記載、不明なら「タグ確認不可」）",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"],
  "selling_points": ["訴求ポイント1", "訴求ポイント2", "訴求ポイント3"],
  "titles": ["タイトル案1", "タイトル案2", "タイトル案3"],
  "description": "（後述のフォーマットで作成した商品説明文）"
}

タイトル要件:
- 各30〜40文字以内
- ブランド名・アイテム名・特徴・状態を含む
- メルカリで検索されやすいキーワードを優先配置

キーワード要件:
- 10〜15個
- 写真で確認できるものは確定表記、不確かなものは末尾に「（候補）」を付ける

説明文フォーマット（必ずこの形式で）:
○商品について
[商品の特徴・魅力を3〜5文で記載。高く売れやすい訴求ポイントを含める]

○状態
[状態の詳細を正直に記載。写真で確認できない部分は「写真にてご確認ください」]

○サイズ・採寸
[タグから読み取れる場合は記載。不明な場合は「写真にてご確認ください」]

○購入元
ブランドリユース店、日本流通自主管理協会加盟店（AACD）にて購入した鑑定済みの正規品です。

○配送
簡易包装にて1〜2日程度で発送いたします。
仕事の都合で遅れる場合がございますのでご了承ください。

○注意事項
中古品のため、写真に写りきらない細かな傷や汚れがある場合がございます。
状態は写真をご確認いただき、ご不明点は購入前にコメントください。

重要な制約:
- 写真から断定できない情報は「写真から確認できる範囲では〜」と表現する
- ブランド名・型番など確証が低い場合は「推定:」「要確認」を必ず明記する
- 確認できないキーワードを説明文に断定で入れないこと`;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

const VALID_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json(500, {
        error: 'APIキーが設定されていません。Netlifyの環境変数（ANTHROPIC_API_KEY）を確認してください。',
      });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'リクエストデータが不正です' });
    }

    const images = body.images || [];

    if (!images.length) {
      return json(400, { error: '写真がアップロードされていません' });
    }
    if (images.length > 20) {
      return json(400, { error: '写真は最大20枚までです' });
    }

    // Build Anthropic content array
    const content = [];
    for (const dataUrl of images) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;

      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) continue;

      const mediaType = dataUrl.slice(5, commaIdx).split(';')[0];
      const data      = dataUrl.slice(commaIdx + 1);

      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: VALID_MEDIA_TYPES.has(mediaType) ? mediaType : 'image/jpeg',
          data,
        },
      });
    }

    if (!content.length) {
      return json(400, { error: '有効な画像ファイルがありません' });
    }

    content.push({ type: 'text', text: ANALYSIS_PROMPT });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content }],
    });

    let resultText = response.content[0].text.trim();

    // Extract JSON from possible markdown wrapper
    if (resultText.includes('```json')) {
      resultText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      resultText = resultText.split('```')[1].split('```')[0].trim();
    }
    const s = resultText.indexOf('{');
    const e = resultText.lastIndexOf('}');
    if (s !== -1 && e !== -1) resultText = resultText.slice(s, e + 1);

    const result = JSON.parse(resultText);
    return json(200, { success: true, data: result });

  } catch (err) {
    console.error('analyze error:', err);

    if (err instanceof SyntaxError) {
      return json(500, { error: 'AI解析結果の解析に失敗しました。もう一度お試しください。' });
    }
    if (err.status === 401) {
      return json(401, { error: 'APIキーが無効です。Netlifyの環境変数を確認してください。' });
    }
    if (err.status === 413) {
      return json(413, { error: '画像容量が大きすぎます。枚数を減らすか、別の写真でお試しください。' });
    }
    if (err.code === 'ERR_NETWORK' || err.name === 'APIConnectionError') {
      return json(503, { error: '通信エラーが発生しました。しばらくしてからお試しください。' });
    }

    return json(500, { error: `エラーが発生しました: ${err.message || '不明なエラー'}` });
  }
};
