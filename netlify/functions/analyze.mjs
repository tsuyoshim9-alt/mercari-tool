import Anthropic from '@anthropic-ai/sdk';

const WATCH_TEMPLATE = `【商品】
（ブランド名・モデル名・型番を要約した商品名。例: ROLEX デイトナ 116500LN）

-ランク-
（写真から判断した状態を S・A・B・C・D・F のいずれか1文字で）

【ブランド / / / 】
【型番 / 】
【素材 / SS / ステンレス 】
【文字盤 / 】
【ムーブメント / クォーツ / quartz 】
【ケースサイズ / mm 】
【腕周り / cm 】
【付属品 / 】
【重さ / g 】

【防水 / 日常生活防水 】
【機能 / 】

-色-
（主な色を記載）

※1枚目の写真が現物に最も近い色味です。


【状態】
【S】新古・未使用品
【A】数回使用程度の美品
【B】多少の傷み・汚れがあるが程度良好の良品
【C】傷み・汚れがある、一般的な使用感のあるお品
【D】使用できるが、傷み・汚れが多く見受けられるお品
【F】ジャンク品・使用不可

写真やランクにて状態のご判断をお願いいたします。

■購入場所
先月に大手企業ブランドオークションや
AACD加盟店、各ストアにて購入いたしました。

■備考
・警察署より古物商許可証を取得済み。
・検査済みの正規品しか取扱いして
おりませんのでご安心してお買い求めください。

■備考〜商品について〜
・写真で伝わらない明らかな欠陥がある
場合のみ商品状態を記載します。
例：タバコ臭/ベタ付き/ファスナー不良等
記載無き場合は、写真やランクにて
状態のご判断をお願いいたします。

・ダメージ等は画像や説明文などで出来る限り
お伝えしておりますが、特性上全ての商品状態を
お伝えすることが難しくなっております。
ご不明な点がございましたらお気軽にご質問下さい。`;

const ANALYSIS_PROMPT = `あなたはメルカリでブランド品・アパレル・時計を販売するエキスパートです。
提供された商品写真を詳細に解析し、以下の構造でJSONのみを返してください。
マークダウンコードブロックや説明文は不要です。JSONそのものだけ返してください。

{
  "category": "バッグ・スーツ・上着・パンツ・スカート・ワンピース・時計・アパレル小物・その他 から最も近いもの",
  "brand": "ブランド名（不確かなら「推定: ○○」、不明なら「不明」）",
  "item_name": "具体的なアイテム名（例: ショルダーバッグ、テーラードジャケット、腕時計）",
  "color": "主な色（複数なら「ブラック×ゴールド」のように記載）",
  "material": "素材（不確かなら「レザー（要確認）」のように記載）",
  "pattern": "柄・デザイン（例: 無地、ストライプ、モノグラム。時計の場合は空文字でよい）",
  "features": ["デザインの特徴1", "特徴2", "特徴3"],
  "condition": "categoryが「時計」以外なら 新品同様・未使用に近い・目立った傷や汚れなし・やや傷や汚れあり・傷や汚れあり から選択。categoryが「時計」なら S・A・B・C・D・F のいずれか1文字（下記ランク基準を参照）",
  "damage": "傷・汚れ・スレ・使用感の詳細（写真から確認できる範囲で正直に記載。なければ「写真から確認できる範囲では目立ったダメージなし」）",
  "model_number": "型番・品番・タグ情報（読み取れれば記載、不明なら「確認不可」）",
  "hardware": "ロゴ・刻印・金具・ファスナーなどの特徴（なければ「特記事項なし」）",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"],
  "selling_points": ["訴求ポイント1", "訴求ポイント2", "訴求ポイント3"],
  "titles": ["タイトル案1", "タイトル案2", "タイトル案3"],
  "description": "（後述のフォーマットで作成した商品説明文。categoryが「時計」かどうかでフォーマットが変わる）"
}

タイトル要件:
- 各30〜40文字以内
- ブランド名・アイテム名・特徴・状態を含む
- メルカリで検索されやすいキーワードを優先配置

キーワード要件:
- 10〜15個
- 写真で確認できるものは確定表記、不確かなものは末尾に「（候補）」を付ける

---
■ categoryが「時計」以外の場合の説明文フォーマット（必ずこの形式で）:
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

---
■ categoryが「時計」の場合の説明文フォーマット（必ずこのテンプレートをそのまま使い、空欄と【商品】【ランク】のみ写真から判断して埋める。
　■購入場所・■備考・■備考〜商品について〜、および【状態】のランク一覧（S〜F）は一字一句変更せずそのまま含めること）:

${WATCH_TEMPLATE}

時計テンプレートの埋め方:
- 【商品】には要約した商品名を1行で記載する
- -ランク- の下には S・A・B・C・D・F のいずれか1文字だけを記載する（判定基準は【状態】の一覧を使う）
- 【ブランド / 】【型番 / 】【文字盤 / 】【腕周り / 】【付属品 / 】【重さ / 】【機能 / 】は、写真から確認できた内容だけを "/" の後ろに記載する。確認できない場合は空欄のままにする（無理に推測や断定をしない）
- 【素材 / SS / ステンレス 】【ムーブメント / クォーツ / quartz 】【ケースサイズ / 　mm 】【防水 / 日常生活防水 】は、写真やタグから読み取れた場合はその内容に書き換え、読み取れない場合はテンプレートの例（SS / ステンレス、クォーツ / quartz、日常生活防水）をそのまま残してよい
- -色- の下の行には主な色（1色）を記載する

重要な制約:
- 写真から断定できない情報は「写真から確認できる範囲では〜」と表現する（時計テンプレートの空欄は上記の埋め方ルールを優先する）
- ブランド名・型番など確証が低い場合は「推定:」「要確認」を必ず明記する（時計テンプレートの項目を除く）
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
  // サーバー側の環境変数へのフォールバックはあえて用意しない。
  // 誰かが画面でキーを入力し忘れても、他人（サイト運営者）のキーで
  // 課金されることが絶対に起きないようにするため。
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
      max_tokens: 2000,
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
