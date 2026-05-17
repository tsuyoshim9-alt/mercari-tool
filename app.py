import os
import json
from flask import Flask, request, jsonify, render_template
import anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

ANALYSIS_PROMPT = """あなたはメルカリでブランド品・アパレルを販売するエキスパートです。
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
- 確認できないキーワードを説明文に断定で入れないこと"""


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:
        api_key = os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            return jsonify({'error': 'APIキーが設定されていません。.envファイルにANTHROPIC_API_KEYを設定してください。'}), 500

        data = request.get_json()
        if not data:
            return jsonify({'error': 'リクエストデータが不正です'}), 400

        images = data.get('images', [])

        if not images:
            return jsonify({'error': '写真がアップロードされていません'}), 400

        if len(images) > 20:
            return jsonify({'error': '写真は最大20枚までです'}), 400

        client = anthropic.Anthropic(api_key=api_key)

        content = []

        for img_data_url in images:
            if not isinstance(img_data_url, str) or not img_data_url.startswith('data:image/'):
                continue

            parts = img_data_url.split(',', 1)
            if len(parts) != 2:
                continue

            header, img_data = parts
            media_type = header.split(';')[0].split(':')[1]

            if media_type not in ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']:
                media_type = 'image/jpeg'

            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": img_data,
                }
            })

        if not content:
            return jsonify({'error': '有効な画像ファイルがありません'}), 400

        content.append({
            "type": "text",
            "text": ANALYSIS_PROMPT
        })

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": content}]
        )

        result_text = response.content[0].text.strip()

        if '```json' in result_text:
            result_text = result_text.split('```json')[1].split('```')[0].strip()
        elif '```' in result_text:
            result_text = result_text.split('```')[1].split('```')[0].strip()

        start = result_text.find('{')
        end = result_text.rfind('}')
        if start != -1 and end != -1:
            result_text = result_text[start:end + 1]

        result = json.loads(result_text)
        return jsonify({'success': True, 'data': result})

    except json.JSONDecodeError:
        return jsonify({'error': 'AI解析結果の解析に失敗しました。もう一度お試しください。'}), 500
    except anthropic.AuthenticationError:
        return jsonify({'error': 'APIキーが無効です。ANTHROPIC_API_KEYを確認してください。'}), 401
    except anthropic.APIConnectionError:
        return jsonify({'error': '通信エラーが発生しました。インターネット接続を確認してください。'}), 503
    except anthropic.APIStatusError as e:
        if e.status_code == 413:
            return jsonify({'error': '画像容量が大きすぎます。送信する画像を減らすか、別の写真でお試しください。'}), 413
        return jsonify({'error': f'APIエラー ({e.status_code}): {e.message}'}), 500
    except Exception as e:
        return jsonify({'error': f'予期せぬエラーが発生しました: {str(e)}'}), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV', 'development') == 'development'
    app.run(debug=debug, port=port)
