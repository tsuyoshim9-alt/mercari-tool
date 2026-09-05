import Anthropic from '@anthropic-ai/sdk';

// 時計の説明文は「AIに丸ごと自由生成させる」のではなく、
// 定型部分（■購入場所・■備考・ランク表など）をコード側で固定し、
// AIには写真から読み取れる項目（ブランド・型番・サイズ等）だけを埋めさせる。
// → モデルがフォーマット指示を無視／崩して出力する事故を防ぐため。
function isWatchCategory(category) {
  return /時計|ウォッチ|watch/i.test(category || '');
}

function cleanField(v) {
  const s = (v == null ? '' : String(v)).trim();
  // 「不明」「確認不可」等のプレースホルダーは空欄として扱う
  if (!s || /^(不明|確認不可|なし|特になし|特記事項なし|-|ー)$/.test(s)) return '';
  return s;
}

// 「【ラベル / 値 】」の1行を作る。値が空なら「【ラベル / 】」（テンプレートの空欄と同じ見た目）にする
function bracketLine(label, value) {
  return value ? `【${label} / ${value} 】` : `【${label} / 】`;
}

function buildWatchDescription(r) {
  const itemName = cleanField(r.watch_item_name) ||
    [cleanField(r.brand), cleanField(r.item_name), cleanField(r.model_number)].filter(Boolean).join(' ');
  const rankRaw = cleanField(r.condition).toUpperCase();
  const rank = /^[SABCDF]$/.test(rankRaw) ? rankRaw : '';
  const brand = cleanField(r.brand);
  const model = cleanField(r.model_number);
  const material = cleanField(r.material) || 'SS / ステンレス';
  const dial = cleanField(r.watch_dial);
  const movement = cleanField(r.watch_movement) || 'クォーツ / quartz';
  const caseSize = cleanField(r.watch_case_size).replace(/mm$/i, '').trim();
  const wrist = cleanField(r.watch_wrist).replace(/cm$/i, '').trim();
  const accessories = cleanField(r.watch_accessories);
  const weight = cleanField(r.watch_weight).replace(/g$/i, '').trim();
  const waterResist = cleanField(r.watch_water_resist) || '日常生活防水';
  const func = cleanField(r.watch_function);
  const color = cleanField(r.color);

  return `【商品】
${itemName}

-ランク-
${rank}

【ブランド /${brand ? ' ' + brand : ''} / / 】
${bracketLine('型番', model)}
${bracketLine('素材', material)}
${bracketLine('文字盤', dial)}
${bracketLine('ムーブメント', movement)}
${bracketLine('ケースサイズ', caseSize ? caseSize + 'mm' : '')}
${bracketLine('腕周り', wrist ? wrist + 'cm' : '')}
${bracketLine('付属品', accessories)}
${bracketLine('重さ', weight ? weight + 'g' : '')}

${bracketLine('防水', waterResist)}
${bracketLine('機能', func)}

-色-
${color}

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
}

const ANALYSIS_PROMPT = `あなたはメルカリでブランド品・アパレル・時計を販売するエキスパートです。
提供された商品写真を詳細に解析し、以下の構造でJSONのみを返してください。
マークダウンコードブロックや説明文は不要です。JSONそのものだけ返してください。

{
  "category": "バッグ・スーツ・上着・パンツ・スカート・ワンピース・時計・アパレル小物・その他 から最も近いもの",
  "brand": "ブランド名（不確かなら「推定: ○○」、不明なら「不明」）",
  "item_name": "具体的なアイテム名（例: ショルダーバッグ、テーラードジャケット、腕時計）",
  "color": "主な色（複数なら「ブラック×ゴールド」のように記載）",
  "material": "素材（不確かなら「レザー（要確認）」のように記載。時計でSS/ステンレス以外の素材が確認できなければ空文字でよい）",
  "pattern": "柄・デザイン（例: 無地、ストライプ、モノグラム。時計の場合は空文字でよい）",
  "features": ["デザインの特徴1", "特徴2", "特徴3"],
  "condition": "categoryが「時計」以外なら 新品同様・未使用に近い・目立った傷や汚れなし・やや傷や汚れあり・傷や汚れあり から選択。categoryが「時計」なら S・A・B・C・D・F のいずれか1文字のみ（S=新古未使用品、A=数回使用程度の美品、B=多少の傷み汚れがあるが程度良好、C=傷み汚れがある一般的な使用感、D=傷み汚れが多い、F=ジャンク品）",
  "damage": "傷・汚れ・スレ・使用感の詳細（写真から確認できる範囲で正直に記載。なければ「写真から確認できる範囲では目立ったダメージなし」）",
  "model_number": "型番・品番・タグ情報（読み取れれば記載、不明なら空文字）",
  "hardware": "ロゴ・刻印・金具・ファスナーなどの特徴（なければ「特記事項なし」）",
  "keywords": ["キーワード1", "キーワード2", "キーワード3"],
  "selling_points": ["訴求ポイント1", "訴求ポイント2", "訴求ポイント3"],
  "titles": ["タイトル案1", "タイトル案2", "タイトル案3"],
  "watch_item_name": "categoryが「時計」のときだけ使用。商品名を1行で要約（例: ROLEX デイトナ 116500LN）。時計以外なら空文字",
  "watch_dial": "categoryが「時計」のときだけ使用。文字盤の色・特徴。時計以外なら空文字",
  "watch_movement": "categoryが「時計」のときだけ使用。ムーブメント（例: クォーツ / quartz、自動巻き / automatic）。確認できなければ空文字",
  "watch_case_size": "categoryが「時計」のときだけ使用。ケースサイズの数値のみ（単位mmは付けない、例: 37）。不明なら空文字",
  "watch_wrist": "categoryが「時計」のときだけ使用。腕周り・バンド長さの数値のみ（単位cmは付けない）。不明なら空文字",
  "watch_accessories": "categoryが「時計」のときだけ使用。付属品（箱・保証書等、写真で確認できたもの）。無ければ空文字",
  "watch_weight": "categoryが「時計」のときだけ使用。重さの数値のみ（単位gは付けない）。不明なら空文字",
  "watch_water_resist": "categoryが「時計」のときだけ使用。防水性能（例: 日常生活防水、100m防水）。確認できなければ空文字",
  "watch_function": "categoryが「時計」のときだけ使用。機能（例: クロノグラフ、デイト表示、GMT）。無ければ空文字",
  "description": "categoryが「時計」以外の商品についてのみ、後述のフォーマットで作成した商品説明文。categoryが「時計」の場合はこのフィールドは空文字でよい（時計の説明文はコード側で組み立てるため）"
}

タイトル要件:
- 各30〜40文字以内
- ブランド名・アイテム名・特徴・状態を含む
- メルカリで検索されやすいキーワードを優先配置

キーワード要件:
- 10〜15個
- 写真で確認できるものは確定表記、不確かなものは末尾に「（候補）」を付ける

説明文フォーマット（categoryが「時計」以外の場合のみ・必ずこの形式で）:
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
- 確認できないキーワードを説明文に断定で入れないこと
- categoryが「時計」の場合、watch_で始まるフィールドと condition（ランク1文字）を正確に埋めることに集中し、description フィールドには何も書かない（空文字にする）`;

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

    // 時計は説明文をコード側で組み立て、AIのフォーマット崩れの影響を受けないようにする
    if (isWatchCategory(result.category)) {
      result.description = buildWatchDescription(result);
    }

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
