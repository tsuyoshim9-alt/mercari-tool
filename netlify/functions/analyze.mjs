import Anthropic from '@anthropic-ai/sdk';

const ANALYSIS_PROMPT = `あなたはメルカリでブランド品・アパレルを販売するエキスパートです。
提供された商品写真を詳細に解析し、以下の構造でJSONのみを返してください。
マークダウンコードブロックや説明文は不要です。JSONそのものだけ返してください。

{
  "category": "バッグ・スーツ・上着・パンツ・スカート・ワンピース・アパレル小物・その他 から最も近いもの",
  "brand": "ブランド名（不確かなら「推定: ○○」、不明なら「不明」）",
  "item_name": "具体的なアイテム名（例: ショルダーバッグ、テーラードジャケット）",
  "color": "主な色（複数なら「ブラック×ゴールド」のように記載）",
  "material": "素材（不確かなら「レザー（要確認）」のように記載）",
  "pattern": "柄・デザイン（例: 無地、ストライプ、モノグラム）",
  "features": ["デザインの特徴1", "特徴2", "特徴3"],
  "condition": "新品同様・未使用に近い・目立った傷や汚れなし・やや傷や汚れあり・傷や汚れあり から選択",
  "damage": "傷・汚れ・スレ・使用感の詳細（写真から確認できる範囲で正直に記載。なければ「写真から確認できる範囲では目立ったダメージなし」）",
  "model_number": "型番・品番・タグ情報（読み取れれば記載、不明なら「確認不可」）",
  "hardware": "ロゴ・刻印・金具・ファスナーなどの特徴（なければ「特記事項なし」）",
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

○素材
[タグ・刻印・質感などから読み取れる素材を記載する。例:「素材: レザー」。確証が低い場合は「素材: レザー（推定）」のように記載する。タグ等から全く読み取れない場合は「素材はタグにてご確認ください」と記載する]

○状態
目立った傷や汚れはありません。気持ちよくご愛用いただけます^^

○サイズ・採寸

○カラー

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
  'Access-Control-Allow-Headers': 'Content-Type, X-Anthropic-Api-Key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const getApiKey = (event) => {
  const headers = event.headers || {};
  const fromHeader =
    headers['x-anthropic-api-key'] ||
    headers['X-Anthropic-Api-Key'];
  if (fromHeader && typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim();
  }
  // ローカル開発用フォールバック
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return null;
};

const formatApiError = (err) => {
  const msg = err.message || '';
  if (msg.includes('credit balance is too low')) {
    return 'Anthropicのクレジット残高が不足しています。Console の Plans & Billing でクレジットを購入してください。';
  }
  if (err.status === 401) {
    return 'APIキーが無効です。Anthropic Console でキーを確認してください。';
  }
  if (err.status === 413) {
    return '画像容量が大きすぎます。枚数を減らすか、別の写真でお試しください。';
  }
  return `エラーが発生しました: ${msg || '不明なエラー'}`;
};

const VALID_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

const reply = (statusCode, body) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  try {
    const apiKey = getApiKey(event);
    if (!apiKey) {
      return reply(400, {
        error: 'APIキーが設定されていません。画面上部でAnthropic APIキーを入力してください。',
      });
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, { error: 'リクエストデータが不正です' });
    }

    const images = body.images || [];

    if (!images.length) {
      return reply(400, { error: '写真がアップロードされていません' });
    }
    if (images.length > 20) {
      return reply(400, { error: '写真は最大20枚までです' });
    }

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
      return reply(400, { error: '有効な画像ファイルがありません' });
    }

    content.push({ type: 'text', text: ANALYSIS_PROMPT });

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content }],
    });

    let resultText = response.content[0].text.trim();

    if (resultText.includes('```json')) {
      resultText = resultText.split('```json')[1].split('```')[0].trim();
    } else if (resultText.includes('```')) {
      resultText = resultText.split('```')[1].split('```')[0].trim();
    }

    const s = resultText.indexOf('{');
    const e = resultText.lastIndexOf('}');
    if (s !== -1 && e !== -1) resultText = resultText.slice(s, e + 1);

    const result = JSON.parse(resultText);
    return reply(200, { success: true, data: result });

  } catch (err) {
    console.error('analyze error:', err.status || err.name, err.message);

    if (err instanceof SyntaxError) {
      return reply(500, { error: 'AI解析結果の解析に失敗しました。もう一度お試しください。' });
    }

    const status = err.status === 401 ? 401 : err.status === 413 ? 413 : 500;
    return reply(status, { error: formatApiError(err) });
  }
};
