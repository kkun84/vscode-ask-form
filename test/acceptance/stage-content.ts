export const query = "TODOアプリを新しく作りたいです。設定をフォームで聞いてください。"
export const reply =
  "ありがとうございます。画面はReact、データはサーバーに保存し、ポート3000でログイン付きにします。src/server.tsとsrc/App.tsxから作り始めます。"
export const followUp = "1ページの件数を50件にしました。一覧の表示とページ送りのテストも合わせて直します。"

export const captions: ReadonlyArray<{ readonly step: string; readonly text: string }> = [
  { step: "1 頼む", text: "決めることが多いとき、「フォームで聞いて」と頼むと…" },
  { step: "2 届く", text: "聞きたいことが<em>1つのフォーム</em>にまとまって届く" },
  { step: "3 選ぶ", text: "<em>選んだ答えに応じて</em>、続きの質問が出てくる" },
  { step: "4 答える", text: "<em>1回で全部</em>答えられる。Copilotはそのまま作り始める" }
]
